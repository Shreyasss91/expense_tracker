import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const transactionTypeEnum = pgEnum("transaction_type", ["income", "expense"]);
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
    type: transactionTypeEnum("type").notNull().default("expense"),
    // Nullable in type only — constrained by CHECK below (§5.2)
    tag: transactionTagEnum("tag"),
    // Read as string; see §5.8
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    note: text("note"),
    // YYYY-MM-DD, Asia/Kolkata calendar date (§5.7)
    date: date("date", { mode: "string" }).notNull(),
    // Postgres TIME; always reads back as HH:MM:SS string (§5.6)
    time: time("time").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
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
    // §5.2 invariant, enforced at the last line of defence
    tagInvariant: check(
      "transactions_tag_invariant",
      sql`(${t.type} = 'expense' AND ${t.tag} IS NOT NULL)
       OR (${t.type} = 'income'  AND ${t.tag} IS NULL)`,
    ),
  }),
);

export type Member = typeof members.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
