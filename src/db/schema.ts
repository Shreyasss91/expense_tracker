import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const transactionTagEnum = pgEnum("transaction_tag", ["one_time", "recurring", "lifestyle"]);

export const members = pgTable("members", {
  id: uuid("id").primaryKey().defaultRandom(),
  // IMMUTABLE identity: 'dad' | 'mom' | 'son' (§3.2.2)
  slug: text("slug").notNull().unique(),
  // MUTABLE display label — editable in Settings (§6.5)
  name: text("name").notNull(),
  emoji: text("emoji").notNull(),
  color: text("color").notNull(),
  sortOrder: integer("sort_order").notNull(),
});

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  // IMMUTABLE identity — never edited by the user (§5.3)
  slug: text("slug").notNull().unique(),
  // MUTABLE display label — editable in Settings (§6.5)
  name: text("name").notNull(),
  emoji: text("emoji").notNull(),
  color: text("color").notNull(),
  sortOrder: integer("sort_order").notNull(),
  /**
   * Two-level hierarchy. NULL = a group row (top level, never directly
   * assignable to a transaction/template/budget); non-NULL = a leaf whose
   * parent must itself be a top-level row. Depth is capped at exactly 2 by
   * the mutation actions — a child can never gain a parent of its own.
   * Every selectable category is therefore a leaf, and every rupee rolls up
   * to exactly one group.
   */
  parentId: uuid("parent_id").references((): AnyPgColumn => categories.id),
});

export const transactions = pgTable(
  "transactions",
  {
    // Quick Add: crypto.randomUUID(). Seed: deterministic UUIDv5 (§8.1). No defaultRandom().
    id: uuid("id").primaryKey(),
    memberId: uuid("member_id")
      .references(() => members.id)
      .notNull(),
    // Nullable (Amendment 20): Quick Add captures without a category; the
    // category is assigned afterwards via the edit dialog or bulk assign.
    // NULL = uncategorized — a transaction state, never a category row.
    categoryId: uuid("category_id").references(() => categories.id),
    tag: transactionTagEnum("tag").notNull(),
    // Read as string; see §5.8
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    note: text("note"),
    // YYYY-MM-DD, Asia/Kolkata calendar date (§5.7)
    date: date("date", { mode: "string" }).notNull(),
    // Postgres TIME; always reads back as HH:MM:SS string (§5.6)
    time: time("time").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Review queue: NULL = pending review if note is generic; set explicitly via acknowledge (§6.4)
    reviewedAt: timestamp("reviewed_at"),
    // §2.2 — shared ownership: an expense can be borne by the household rather
    // than the single member who logged it. `shared` flags it; `split_with`
    // names the members to split among (empty = everyone). Attribution credits
    // each member their solo spend plus an equal share of each shared expense.
    shared: boolean("shared").notNull().default(false),
    splitWith: text("split_with").array().notNull().default([]),
  },
  (t) => ({
    dateIdx: index("transactions_date_idx").on(t.date),
    memberIdx: index("transactions_member_id_idx").on(t.memberId),
    categoryIdx: index("transactions_category_id_idx").on(t.categoryId),
    // Keyset pagination cursor (§7.3) — must match the ORDER BY exactly, all four columns
    listCursorIdx: index("transactions_list_cursor_idx").on(
      t.date.desc(),
      t.time.desc(),
      t.createdAt.desc(),
      t.id.desc(),
    ),
    // UX/perf pass — substring note search (`?q=` → ILIKE '%term%') via pg_trgm.
    // The extension is created by migration drizzle/0006_note_search_trgm.sql;
    // this definition keeps the index present through future push/diff cycles.
    noteTrgmIdx: index("transactions_note_trgm_idx").using("gin", sql`${t.note} gin_trgm_ops`),
    // §1.9 — partial index that serves the pending-review query
    // (WHERE reviewed_at IS NULL) without a full-table scan. reviewed_at has
    // no default, so untouched rows are NULL and land in this index.
    reviewedPendingIdx: index("transactions_reviewed_at_pending_idx")
      .on(t.reviewedAt)
      .where(sql`${t.reviewedAt} IS NULL`),
  }),
);

/**
 * Monthly budgets (§6.7, extended §2.1). One row per (month, scope) scope where
 * the scope is exactly one of:
 *  - total:      month set (or NULL = every-month default), categoryId NULL, groupId NULL
 *  - category:   a single LEAF category id
 *  - group:      a top-level GROUP id — rolls up all its leaves' spend (§2.1)
 * The effective budget for a month prefers the exact-month row over the default.
 * Budget scopes are intentionally replaced with sequential DELETE + INSERT statements
 * rather than a database transaction because the application's neon-http driver does
 * not provide transaction support for this path. The accepted non-atomic failure mode
 * is documented in SPEC.md §6.7.
 */
export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    month: text("month"),
    categoryId: uuid("category_id").references(() => categories.id),
    // §2.1 — a top-level GROUP id; when set the budget caps the roll-up of all
    // its leaves. Mutually exclusive with categoryId within a single row.
    groupId: uuid("group_id").references(() => categories.id),
    // Read as string; see §5.8
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // one budget per (month, scope) — all three scope axes collapsed via COALESCE
    // so at most one total / per-category / per-group row exists per (month, scope).
    scopeUnique: uniqueIndex("budgets_scope_unique").on(
      sql`COALESCE(${t.month}, '')`,
      sql`COALESCE(${t.categoryId}::text, '')`,
      sql`COALESCE(${t.groupId}::text, '')`,
    ),
  }),
);

/**
 * Key-value app settings (§6.7). One row per key; values are plain strings.
 * Currently holds `exclude_bills_from_budget` ('1'/'0') — the global
 * "exclude bills from the total budget" toggle. Read/written via
 * src/db/app-settings-mutations.ts (plain statements).
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Member = typeof members.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Budget = typeof budgets.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;

/** Recurring template row (§6.5). */
export const templates = pgTable("templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(), // user-editable label, e.g. "ICICI Term Insurance"
  categoryId: uuid("category_id")
    .references(() => categories.id)
    .notNull(),
  tag: transactionTagEnum("tag").notNull(), // §5.2 triad applies to templates
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(), // §5.8
  note: text("note"), // optional prefill note
  // Recurring auto-entry (UX pass): day of month (1–28) the daily cron stamps
  // this template into the ledger automatically; NULL = manual-only template.
  autoDay: integer("auto_day"),
  // "YYYY-MM" of the last auto-stamped month — the idempotency marker that
  // keeps the daily cron from creating the same bill twice in one month.
  lastAutoKey: text("last_auto_key"),
  // Whose ledger the auto-created entry lands under; NULL = the first member
  // (lowest sort order) as the household default. Manual Quick Add prefills
  // still run under the active member — this only affects cron creation.
  memberId: uuid("member_id").references(() => members.id),
  sortOrder: integer("sort_order").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  sortOrderIdx: index("templates_sort_order_idx").on(t.sortOrder),
  autoDayIdx: index("templates_auto_day_idx").on(t.autoDay),
}));

export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;

/**
 * Saved ledger searches (§2.7). A household-wide library of named filter
 * presets — "Big fuel spends", "Kid stuff last quarter" — each storing the
 * serialized LedgerFilters so a tap re-applies the exact query. One master
 * password = one household, so there is no per-member ownership column.
 * `params` is a JSON copy of the sanitized LedgerFilters (members / tags /
 * category / amount range / q / date range), with `month` deliberately
 * omitted so a saved search stays reusable across months.
 */
export const savedSearches = pgTable("saved_searches", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  params: jsonb("params").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SavedSearch = typeof savedSearches.$inferSelect;

/**
 * Receipt / attachment rows (§2.9). One transaction can carry several photos
 * (a bill plus its GST slip), so this is a child table rather than a column.
 *
 * The bytes live in object storage (Vercel Blob); this row keeps only the
 * locator. `url` is the store's public URL but is never handed to the client
 * directly — every read goes through /api/attachments/[id], which re-checks the
 * session and streams the bytes, so receipts stay behind the app's auth (§1.5).
 * `pathname` is what the store's DELETE endpoint needs, so it must be kept.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .references(() => transactions.id, { onDelete: "cascade" })
      .notNull(),
    /** Object-storage locator, e.g. "receipts/2026/09/<uuid>.jpg". */
    pathname: text("pathname").notNull(),
    /** The store's URL — read back through an authed proxy, never served raw. */
    url: text("url").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    txIdx: index("attachments_transaction_id_idx").on(t.transactionId),
  }),
);

export type Attachment = typeof attachments.$inferSelect;

/**
 * Web Push subscriptions (§2.11). One household, one master password — so
 * subscriptions are NOT per-user: every device that opts in receives the
 * same household notifications (budget pacing, review reminders). The push
 * subscription endpoint is a bearer of its own (it is the URL the push
 * service POSTs to), so the auth material is the two keys the browser hands
 * us at subscribe time, stored verbatim and fed straight into the Web Push
 * encryption (draft-ietf-webpush-encryption) on send.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The push service endpoint URL — the only externally routable secret. */
    endpoint: text("endpoint").notNull().unique(),
    /** Base64url `p256dh` (client public key) from PushSubscription.keys. */
    p256dh: text("p256dh").notNull(),
    /** Base64url `auth` from PushSubscription.keys. */
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // A stale subscription (app uninstalled, permission revoked) returns 404
    // or 410 on send; we delete on seeing that, but last_seen lets a future
    // cleanup sweep drop ancient, never-reused rows too.
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  },
  (t) => ({
    createdIdx: index("push_subscriptions_created_at_idx").on(t.createdAt),
  }),
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
