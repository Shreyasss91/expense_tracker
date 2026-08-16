import "server-only";

import { and, desc, eq, gte, ilike, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { rupeesToPaise } from "@/lib/money";

export const PAGE_SIZE = 50; // §7.3

export interface TransactionListFilters {
  memberId?: string;
  categoryId?: string;
  tag?: "one_time" | "recurring" | "lifestyle";
  type?: "income" | "expense";
  /** YYYY-MM */
  month?: string;
  search?: string;
}

export interface Cursor {
  date: string;
  time: string;
  createdAt: string; // ISO
  id: string;
}

export interface TransactionListRow {
  id: string;
  memberId: string;
  categoryId: string;
  type: "income" | "expense";
  tag: "one_time" | "recurring" | "lifestyle" | null;
  amount: string;
  note: string | null;
  date: string;
  time: string;
  createdAt: string; // ISO
  member: { name: string; emoji: string; color: string; slug: string };
  category: { name: string; emoji: string; color: string; slug: string };
}

function monthEnd(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${monthKey}-${String(lastDay).padStart(2, "0")}`;
}

export function buildWhere(filters: TransactionListFilters, cursor: Cursor | null): SQL | undefined {
  const conds: SQL[] = [];
  if (filters.memberId) conds.push(eq(transactions.memberId, filters.memberId));
  if (filters.categoryId) conds.push(eq(transactions.categoryId, filters.categoryId));
  if (filters.tag) conds.push(eq(transactions.tag, filters.tag));
  if (filters.type) conds.push(eq(transactions.type, filters.type));
  if (filters.month) {
    conds.push(gte(transactions.date, `${filters.month}-01`), lte(transactions.date, monthEnd(filters.month)));
  }
  if (filters.search?.trim()) conds.push(ilike(transactions.note, `%${filters.search.trim()}%`));

  // §7.3 keyset cursor — strict total order (date DESC, time DESC, created_at DESC, id DESC)
  if (cursor) {
    conds.push(
      or(
        lt(transactions.date, cursor.date),
        and(eq(transactions.date, cursor.date), lt(transactions.time, cursor.time)),
        and(
          eq(transactions.date, cursor.date),
          eq(transactions.time, cursor.time),
          lt(transactions.createdAt, new Date(cursor.createdAt)),
        ),
        and(
          eq(transactions.date, cursor.date),
          eq(transactions.time, cursor.time),
          eq(transactions.createdAt, new Date(cursor.createdAt)),
          lt(transactions.id, cursor.id),
        ),
      )!,
    );
  }
  return conds.length ? and(...conds) : undefined;
}

export function mapRow(row: {
  id: string;
  memberId: string;
  categoryId: string;
  type: string;
  tag: string | null;
  amount: string;
  note: string | null;
  date: string;
  time: string;
  createdAt: Date;
  memberName: string;
  memberEmoji: string;
  memberColor: string;
  memberSlug: string;
  categoryName: string;
  categoryEmoji: string;
  categoryColor: string;
  categorySlug: string;
}): TransactionListRow {
  return {
    id: row.id,
    memberId: row.memberId,
    categoryId: row.categoryId,
    type: row.type as "income" | "expense",
    tag: row.tag as TransactionListRow["tag"],
    amount: row.amount,
    note: row.note,
    date: row.date,
    time: row.time,
    createdAt: row.createdAt.toISOString(),
    member: {
      name: row.memberName,
      emoji: row.memberEmoji,
      color: row.memberColor,
      slug: row.memberSlug,
    },
    category: {
      name: row.categoryName,
      emoji: row.categoryEmoji,
      color: row.categoryColor,
      slug: row.categorySlug,
    },
  };
}

/** §7.3 canonical ordering — identical in the list query and the cursor comparison. */
export const listOrderBy = [
  desc(transactions.date),
  desc(transactions.time),
  desc(transactions.createdAt),
  desc(transactions.id),
];

export interface LedgerSummary {
  expensePaise: number;
  lifestylePaise: number;
  largestPaise: number | null;
  count: number;
}

/**
 * One-pass aggregate for the ledger's summary header. Uses the same
 * buildWhere() as the list, so the numbers describe exactly the filtered set
 * (month + member + category + tag + search) — never just the visible page.
 * Mirrors the dashboard's expense-focused cards: total, lifestyle and the
 * largest single spend in the filtered set.
 */
export async function getLedgerSummary(filters: TransactionListFilters): Promise<LedgerSummary> {
  const where = buildWhere(filters, null);
  const rows = await db
    .select({
      expense: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.type} = 'expense'), 0)`,
      lifestyle: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.type} = 'expense' AND ${transactions.tag} = 'lifestyle'), 0)`,
      largest: sql<string | null>`MAX(${transactions.amount}) FILTER (WHERE ${transactions.type} = 'expense')`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(transactions)
    .where(where);
  const r = rows[0];
  return {
    expensePaise: rupeesToPaise(r.expense),
    lifestylePaise: rupeesToPaise(r.lifestyle),
    largestPaise: r.largest === null ? null : rupeesToPaise(r.largest),
    count: Number(r.count),
  };
}
