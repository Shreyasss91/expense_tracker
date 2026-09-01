import { and, desc, eq, gte, ilike, inArray, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { categories, transactions } from "@/db/schema";
import { paiseToDbString, rupeesToPaise } from "@/lib/money";
import { monthKeySchema } from "@/lib/validations";

export const PAGE_SIZE = 50; // §7.3

export interface TransactionListFilters {
  memberId?: string;
  /** Leaf-category filter (?category=<uuid>). Wins over groupId/uncategorized. */
  categoryId?: string;
  /**
   * Group filter (?group=<uuid>) — matches any transaction whose leaf
   * belongs to the group. Never queried directly: expandGroupFilter()
   * resolves it to `categoryIds` before buildWhere runs.
   */
  groupId?: string;
  /** Internal — the expanded form of groupId (leaf ids of that group). */
  categoryIds?: string[];
  /** Amendment 20 — `category=uncategorized` in the URL; rows with NULL category_id. */
  uncategorized?: boolean;
  tag?: "one_time" | "recurring" | "lifestyle";
  /** §2.7 — amount range, in paise. Used by the "real query tool" search. */
  amountMin?: number;
  amountMax?: number;
  /** YYYY-MM */
  month?: string;
  /** UX pass — custom date range (inclusive), YYYY-MM-DD. */
  from?: string;
  to?: string;
  search?: string;
}

export interface Cursor {
  date: string;
  time: string;
  createdAt: string; // ISO
  id: string;
}

function monthEnd(monthKey: string): string {
  const month = monthKeySchema.parse(monthKey);
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

export function buildWhere(filters: TransactionListFilters, cursor: Cursor | null): SQL | undefined {
  const conds: SQL[] = [];
  if (filters.memberId) conds.push(eq(transactions.memberId, filters.memberId));
  // Category precedence: exact leaf > group expansion > uncategorized.
  if (filters.categoryId) conds.push(eq(transactions.categoryId, filters.categoryId));
  else if (filters.categoryIds !== undefined) {
    // A group with no children matches nothing — an explicit FALSE keeps the
    // semantics honest instead of silently widening to "everything".
    conds.push(filters.categoryIds.length > 0 ? inArray(transactions.categoryId, filters.categoryIds) : sql`false`);
  } else if (filters.uncategorized) conds.push(isNull(transactions.categoryId));
  if (filters.tag) conds.push(eq(transactions.tag, filters.tag));
  if (filters.month) {
    const month = monthKeySchema.parse(filters.month);
    conds.push(gte(transactions.date, `${month}-01`), lte(transactions.date, monthEnd(month)));
  }
  if (filters.from) conds.push(gte(transactions.date, filters.from));
  if (filters.to) conds.push(lte(transactions.date, filters.to));
  // §2.7 — amount range, compared against the numeric amount column (the
  // stored value is a string, so cast both sides). Stored in paise; divide
  // back to rupees for the comparison literal.
  if (filters.amountMin != null && filters.amountMin > 0) {
    conds.push(sql`CAST(${transactions.amount} AS numeric) >= CAST(${paiseToDbString(filters.amountMin)} AS numeric)`);
  }
  if (filters.amountMax != null && filters.amountMax > 0) {
    conds.push(sql`CAST(${transactions.amount} AS numeric) <= CAST(${paiseToDbString(filters.amountMax)} AS numeric)`);
  }
  if (filters.search?.trim()) {
    // §2.7 — multi-term AND: split on whitespace and require every term to
    // match the note (substring, case-insensitive). §1.10 — escape LIKE/ILIKE
    // metacharacters so a term like `%` matches the literal character rather
    // than acting as a wildcard over every row.
    const terms = filters.search.trim().split(/\s+/).filter(Boolean);
    const termConds = terms.map((raw) => {
      const term = raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
      return ilike(transactions.note, `%${term}%`);
    });
    conds.push(and(...termConds)!);
  }

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

/**
 * Resolve the group filter into its leaf-id list before buildWhere runs
 * (buildWhere is sync; this is the only async step). Precedence: an exact
 * categoryId or uncategorized flag suppresses the group filter entirely —
 * the URL builder never emits both, but deep links might.
 */
export async function expandGroupFilter<T extends TransactionListFilters>(filters: T): Promise<T> {
  if (!filters.groupId || filters.categoryId || filters.uncategorized) return filters;
  const children = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.parentId, filters.groupId));
  return { ...filters, categoryIds: children.map((c) => c.id) };
}

export function mapRow(row: {  id: string;
  memberId: string;
  categoryId: string | null;
  tag: string | null;
  amount: string;
  note: string | null;
  date: string;
  time: string;
  createdAt: Date;
  reviewedAt: Date | null;
  shared: boolean;
  splitWith: string[] | null;
  memberName: string;
  memberEmoji: string;
  memberColor: string;
  memberSlug: string;
  categoryName: string | null;
  categoryEmoji: string | null;
  categoryColor: string | null;
  categorySlug: string | null;
}): TransactionListRow {
  return {
    id: row.id,
    memberId: row.memberId,
    categoryId: row.categoryId,
    tag: row.tag as TransactionListRow["tag"],
    amount: row.amount,
    note: row.note,
    date: row.date,
    time: row.time,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    shared: row.shared,
    splitWith: row.splitWith ?? [],
    member: {
      name: row.memberName,
      emoji: row.memberEmoji,
      color: row.memberColor,
      slug: row.memberSlug,
    },
    // Amendment 20 — NULL category_id = uncategorized; the joined fields come
    // back null with it, so the whole object collapses to null.
    category:
      row.categoryId && row.categoryName
        ? {
            name: row.categoryName,
            emoji: row.categoryEmoji ?? "🏷️",
            color: row.categoryColor ?? "#9ca3af",
            slug: row.categorySlug ?? "",
          }
        : null,
  };
}

/** §7.3 canonical ordering — identical in the list query and the cursor comparison. */
export const listOrderBy = [
  desc(transactions.date),
  desc(transactions.time),
  desc(transactions.createdAt),
  desc(transactions.id),
];

export interface TransactionListRow {
  id: string;
  memberId: string;
  /** NULL = uncategorized (Amendment 20). */
  categoryId: string | null;
  tag: "one_time" | "recurring" | "lifestyle" | null;
  amount: string;
  note: string | null;
  date: string;
  time: string;
  createdAt: string;
  reviewedAt: string | null;
  /** §2.2 — shared across the household, not borne by one member. */
  shared: boolean;
  /** §2.2 — member ids to split a shared expense among; [] = everyone. */
  splitWith: string[];
  member: { name: string; emoji: string; color: string; slug: string };
  /** NULL = uncategorized — rendered as an explicit "Uncategorized" state. */
  category: { name: string; emoji: string; color: string; slug: string } | null;
}

export interface LedgerSummary {
  expensePaise: number;
  lifestylePaise: number;
  largestPaise: number | null;
  count: number;
  /** Amendment 20 — uncategorized entries inside the filtered set (count + sum). */
  uncategorizedCount: number;
  uncategorizedPaise: number;
}

/**
 * One-pass aggregate for the ledger's summary header. Uses the same
 * buildWhere() as the list, so the numbers describe exactly the filtered set
 * (month + member + category + tag + search) — never just the visible page.
 * Mirrors the dashboard's expense-focused cards: total, lifestyle and the
 * largest single spend in the filtered set.
 */
export async function getLedgerSummary(
  filters: TransactionListFilters,
  excludeBills = false,
): Promise<LedgerSummary> {
  const where = buildWhere(await expandGroupFilter(filters), null);
  const rows = await db
    .select({
      expense: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
      // §1.10 — compute recurring separately so the headline total can mirror
      // the budget bar, which subtracts recurring when exclude-bills is on.
      recurring: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.tag} = 'recurring'), 0)`,
      lifestyle: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.tag} = 'lifestyle'), 0)`,
      largest: sql<string | null>`MAX(${transactions.amount})`,
      count: sql<number>`COUNT(*)::int`,
      uncategorizedCount: sql<number>`COUNT(*) FILTER (WHERE ${transactions.categoryId} IS NULL)::int`,
      uncategorized: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.categoryId} IS NULL), 0)`,
    })
    .from(transactions)
    .where(where);
  const r = rows[0];
  const expensePaise = rupeesToPaise(r.expense);
  const billsPaise = rupeesToPaise(r.recurring);
  return {
    // §1.10 — when the global exclude-bills toggle is on, the ledger headline
    // now matches the budget bar instead of disagreeing with it.
    expensePaise: excludeBills ? expensePaise - billsPaise : expensePaise,
    lifestylePaise: rupeesToPaise(r.lifestyle),
    largestPaise: r.largest === null ? null : rupeesToPaise(r.largest),
    count: Number(r.count),
    uncategorizedCount: Number(r.uncategorizedCount),
    uncategorizedPaise: rupeesToPaise(r.uncategorized),
  };
}
