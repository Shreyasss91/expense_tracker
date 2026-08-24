import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
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
});

export const transactions = pgTable(
  "transactions",
  {
    // Quick Add: crypto.randomUUID(). Seed: deterministic UUIDv5 (§8.1). No defaultRandom().
    id: uuid("id").primaryKey(),
    memberId: uuid("member_id")
      .references(() => members.id)
      .notNull(),
    categoryId: uuid("category_id")
      .references(() => categories.id)
      .notNull(),
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
  }),
);

/**
 * Monthly budgets (§6.7). One row per (month, category) scope:
 *  - month: 'yyyy-MM' for a single month, NULL for the default applying to every month.
 *  - categoryId: NULL = total monthly limit; a category id = limit for that category.
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
    // Read as string; see §5.8
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // one budget per (month, category) scope — NULLs collapsed via COALESCE
    scopeUnique: uniqueIndex("budgets_scope_unique").on(
      sql`COALESCE(${t.month}, '')`,
      sql`COALESCE(${t.categoryId}::text, '')`,
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
  sortOrder: integer("sort_order").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  sortOrderIdx: index("templates_sort_order_idx").on(t.sortOrder),
}));

export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;
