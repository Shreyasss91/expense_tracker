"use server";

import { auth } from "@/auth";
import { randomUUID } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { cookies } from "next/headers";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, members, transactions } from "@/db/schema";
import { isAssignableCategory } from "@/db/category-mutations";
import { paiseToDbString } from "@/lib/money";
import { todayInIST } from "@/lib/dates";
import { idSchema, transactionSchema, type TransactionInput } from "@/lib/validations";
import { buildWhere, expandGroupFilter, listOrderBy, mapRow, PAGE_SIZE, type Cursor, type TransactionListFilters } from "@/lib/query";
import { CSV_HEADER, formatCsvLine } from "@/lib/csv-export";
import { getBudgetAlert } from "@/lib/budgets";
import type { BudgetAlert } from "@/lib/budget-alert";
import { isGenericNote } from "@/lib/generic-notes";
import { pendingReviewWhere } from "@/lib/review-where";

export async function createTransaction(raw: TransactionInput) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Unauthorized" };
  const parsed = transactionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid transaction data" };

  const data = parsed.data;
  // Member resolution: the payload's memberId wins when it names a real
  // member — offline Quick Add replays queued entries later, possibly under
  // a different active_member_id cookie, and the entry must land under the
  // member who captured it. Falls back to the cookie (§6.2 normal path).
  const cookieStore = await cookies();
  let memberId: string | null = null;
  if (data.memberId) {
    const byPayload = await db.query.members.findFirst({ where: eq(members.id, data.memberId) });
    if (byPayload) memberId = byPayload.id;
  }
  if (!memberId) {
    const activeMemberId = cookieStore.get("active_member_id")?.value;
    const memberIdCheck = idSchema.safeParse(activeMemberId);
    if (!memberIdCheck.success) {
      return { ok: false as const, error: "No active member selected — pick a member in the header" };
    }
    const memberExists = await db.query.members.findFirst({ where: eq(members.id, memberIdCheck.data) });
    if (!memberExists) return { ok: false as const, error: "Unknown member" };
    memberId = memberIdCheck.data;
  }

  // Amendment 20 — the category is optional; when present it must exist and
  // be a leaf (groups are never directly assignable).
  if (data.categoryId) {
    if (!(await isAssignableCategory(db, data.categoryId))) return { ok: false as const, error: "Unknown or non-assignable category" };
  }

  const paise = data.amount;

  // §1.10 — guard the whole mutation so a DB error becomes a typed error
  // response instead of an unhandled throw, and so row.id can never be read
  // off an undefined insert result.
  try {
    const [row] = await db
      .insert(transactions)
      .values({
        id: randomUUID(),
        memberId,
        categoryId: data.categoryId ?? null,
        tag: data.tag,
        amount: paiseToDbString(paise),
        note: data.note ?? null,
        date: data.date,
        time: `${data.time}:00`,
        // §1.11 / §6.4 — generic notes stay NULL (pending review); a real note
      // is auto-acknowledged (timestamped) on creation. The previous
      // `? null : undefined` was a no-op: both branches produced NULL because
      // the column has no default, so real notes were never marked reviewed.
      reviewedAt: isGenericNote(data.note ?? null) ? null : new Date(),
      })
      .returning();

    if (!row) return { ok: false as const, error: "Failed to create transaction" };

    revalidatePath("/");
    revalidatePath("/transactions");
    revalidateTag("transactions");

    const alert: BudgetAlert | null = await getBudgetAlert(db, data.date.slice(0, 7), data.categoryId ?? null);

    return { ok: true as const, id: row.id, alert };
  } catch (error) {
    console.error("createTransaction failed", error);
    return { ok: false as const, error: "Could not save the transaction" };
  }
}

export async function updateTransaction(id: string, raw: TransactionInput) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Unauthorized" };
  const idCheck = idSchema.safeParse(id);
  if (!idCheck.success) return { ok: false as const, error: "Invalid transaction id" };

  const parsed = transactionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid transaction data" };
  const data = parsed.data;

  const memberExists = await db.query.members.findFirst({ where: eq(members.id, data.memberId) });
  if (!memberExists) return { ok: false as const, error: "Unknown member" };
  if (data.categoryId) {
    if (!(await isAssignableCategory(db, data.categoryId))) return { ok: false as const, error: "Unknown or non-assignable category" };
  }

  const [existing] = await db
    .select({ note: transactions.note })
    .from(transactions)
    .where(eq(transactions.id, idCheck.data));
  const noteChanged = (existing?.note ?? null) !== (data.note ?? null);

  const [row] = await db
    .update(transactions)
    .set({
      memberId: data.memberId,
      categoryId: data.categoryId ?? null,
      tag: data.tag,
      amount: paiseToDbString(data.amount),
      note: data.note ?? null,
      date: data.date,
      time: `${data.time}:00`,
      // Acknowledgement survives ordinary edits, but any note edit explicitly
      // sends the row back through the Review queue (§6.4).
      ...(noteChanged ? { reviewedAt: null } : {}),
    })
    .where(eq(transactions.id, idCheck.data))
    .returning();

  if (!row) return { ok: false as const, error: "Transaction not found" };

  revalidatePath("/");
  revalidatePath("/transactions");
  revalidateTag("transactions");

  const alert: BudgetAlert | null = await getBudgetAlert(db, data.date.slice(0, 7), data.categoryId ?? null);

  return { ok: true as const, id: row.id, alert };
}

/** Amendment 20 — max ids per bulk call; the UI pages selection well below this. */
const BULK_MAX = 500;

/**
 * Amendment 20 — assign one category to many transactions in a single
 * UPDATE. `categoryId: null` clears the category ("Uncategorized").
 */
export async function assignCategory(ids: string[], categoryId: string | null): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Unauthorized" };
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false as const, error: "Nothing selected" };
  if (ids.length > BULK_MAX) return { ok: false as const, error: `Select at most ${BULK_MAX} transactions` };
  const checkedIds = ids.map((id) => idSchema.safeParse(id)).filter((r) => r.success).map((r) => r.data);
  if (checkedIds.length !== ids.length) return { ok: false as const, error: "Invalid transaction id" };

  if (categoryId !== null) {
    if (!(await isAssignableCategory(db, categoryId))) return { ok: false as const, error: "Unknown or non-assignable category" };
  }

  const rows = await db
    .update(transactions)
    .set({ categoryId })
    .where(inArray(transactions.id, checkedIds))
    .returning({ id: transactions.id });

  revalidatePath("/");
  revalidatePath("/transactions");
  revalidateTag("transactions");

  return { ok: true as const, updated: rows.length };
}

/** Amendment 20 — hard-delete many transactions in one statement (no undo server-side; the UI owns the undo window). */
export async function deleteTransactions(ids: string[]): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Unauthorized" };
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false as const, error: "Nothing selected" };
  if (ids.length > BULK_MAX) return { ok: false as const, error: `Select at most ${BULK_MAX} transactions` };
  const checkedIds = ids.map((id) => idSchema.safeParse(id)).filter((r) => r.success).map((r) => r.data);
  if (checkedIds.length !== ids.length) return { ok: false as const, error: "Invalid transaction id" };

  const rows = await db
    .delete(transactions)
    .where(inArray(transactions.id, checkedIds))
    .returning({ id: transactions.id });

  revalidatePath("/");
  revalidatePath("/transactions");
  revalidateTag("transactions");

  return { ok: true as const, deleted: rows.length };
}

export async function deleteTransaction(id: string) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Unauthorized" };
  const idCheck = idSchema.safeParse(id);
  if (!idCheck.success) return { ok: false as const, error: "Invalid transaction id" };

  const [row] = await db
    .delete(transactions)
    .where(eq(transactions.id, idCheck.data))
    .returning({ id: transactions.id });
  if (!row) return { ok: false as const, error: "Transaction not found" };

  revalidatePath("/");
  revalidatePath("/transactions");
  revalidateTag("transactions");
  return { ok: true as const };
}

/** Acknowledge a review item by setting reviewed_at (§6.4). */
export async function acknowledgeTransactionReview(id: string) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Unauthorized" };
  const idCheck = idSchema.safeParse(id);
  if (!idCheck.success) return { ok: false as const, error: "Invalid transaction id" };

  const [row] = await db
    .update(transactions)
    .set({ reviewedAt: new Date() })
    .where(eq(transactions.id, idCheck.data))
    .returning({ id: transactions.id });

  if (!row) return { ok: false as const, error: "Transaction not found" };

  revalidatePath("/review");
  revalidateTag("transactions");
  return { ok: true as const };
}

/** Amendment 20 — acknowledge many review items at once ("Acknowledge all"). */
export async function acknowledgeTransactionsReview(ids: string[]): Promise<{ ok: true; acknowledged: number } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Unauthorized" };
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false as const, error: "Nothing selected" };
  if (ids.length > BULK_MAX) return { ok: false as const, error: `Select at most ${BULK_MAX} transactions` };
  const checkedIds = ids.map((id) => idSchema.safeParse(id)).filter((r) => r.success).map((r) => r.data);
  if (checkedIds.length !== ids.length) return { ok: false as const, error: "Invalid transaction id" };

  const rows = await db
    .update(transactions)
    .set({ reviewedAt: new Date() })
    .where(inArray(transactions.id, checkedIds))
    .returning({ id: transactions.id });

  revalidatePath("/");
  revalidatePath("/transactions");
  revalidateTag("transactions");

  return { ok: true as const, acknowledged: rows.length };
}

/** Get pending review count for the badge (§6.4). */
export async function getPendingReviewCount(): Promise<number> {
  const session = await auth();
  if (!session?.user) return 0;
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(pendingReviewWhere());
  return Number(result[0]?.count ?? 0);
}

/** Amendment 20 — count of uncategorized transactions, for the nav badge nudge. */
export async function getUncategorizedCount(): Promise<number> {
  const session = await auth();
  if (!session?.user) return 0;
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(sql`${transactions.categoryId} IS NULL`);
  return Number(result[0]?.count ?? 0);
}

/** §1.9 — single round-trip for both bottom-nav badges (pending review +
 * uncategorized), replacing the two separate 30s pollers. Reuses the exact
 * predicates of getPendingReviewCount / getUncategorizedCount so the numbers
 * stay identical. */
export async function getNavCounts(): Promise<{ pending: number; uncategorized: number }> {
  const session = await auth();
  if (!session?.user) return { pending: 0, uncategorized: 0 };
  const [pendingRes, uncatRes] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(transactions).where(pendingReviewWhere()),
    db.select({ count: sql<number>`count(*)` }).from(transactions).where(sql`${transactions.categoryId} IS NULL`),
  ]);
  return {
    pending: Number(pendingRes[0]?.count ?? 0),
    uncategorized: Number(uncatRes[0]?.count ?? 0),
  };
}

export async function getTransactionsPage(args: {
  cursor: Cursor | null;
  filters: TransactionListFilters;
}): Promise<{ rows: ReturnType<typeof mapRow>[]; nextCursor: Cursor | null }> {
  const session = await auth();
  if (!session?.user) return { rows: [], nextCursor: null };
  const where = buildWhere(await expandGroupFilter(args.filters), args.cursor);

  const rows = await db
    .select({
      id: transactions.id,
      memberId: transactions.memberId,
      categoryId: transactions.categoryId,
      tag: transactions.tag,
      amount: transactions.amount,
      note: transactions.note,
      date: transactions.date,
      time: transactions.time,
      createdAt: transactions.createdAt,
      reviewedAt: transactions.reviewedAt,
      memberName: members.name,
      memberEmoji: members.emoji,
      memberColor: members.color,
      memberSlug: members.slug,
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
      categoryColor: categories.color,
      categorySlug: categories.slug,
    })
    .from(transactions)
    .innerJoin(members, eq(transactions.memberId, members.id))
    // Amendment 20 — left join: uncategorized rows list with a null category.
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(where)
    .orderBy(...listOrderBy)
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const last = page[page.length - 1];

  return {
    rows: page.map(mapRow),
    nextCursor: hasMore && last ? { date: last.date, time: last.time, createdAt: last.createdAt.toISOString(), id: last.id } : null,
  };
}

/**
 * UX pass — CSV export now honors the ledger's active filter set when one is
 * provided (month/member/tag/category/uncategorized/search/date-range);
 * called with no arguments it exports everything, as before. The WHERE is
 * built by the same buildWhere() the list uses, so the file always describes
 * exactly what the user was looking at.
 */
export async function exportCsv(filters?: TransactionListFilters): Promise<{ ok: true; csv: string; filename: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Unauthorized" };
  const where = filters && Object.keys(filters).length > 0 ? buildWhere(await expandGroupFilter(filters), null) : undefined;

  const rows = await db
    .select({
      date: transactions.date,
      time: transactions.time,
      member: members.name,
      note: transactions.note,
      amount: transactions.amount,
      category: categories.name,
      tag: transactions.tag,
    })
    .from(transactions)
    .innerJoin(members, eq(transactions.memberId, members.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(where)
    // §1.10 — qualify every column (the LEFT JOIN to categories also has a
    // created_at, so the bare `created_at` was ambiguous) and extend the
    // tiebreak through time/created_at/id so the export order is fully
    // deterministic and matches the ledger's keyset ordering.
    .orderBy(
      sql`${transactions.date} ASC, ${transactions.time} ASC, ${transactions.createdAt} ASC, ${transactions.id} ASC`,
    );

  const lines = rows.map((r) =>
    formatCsvLine({
      date: r.date,
      time: r.time,
      member: r.member,
      note: r.note,
      amount: r.amount,
      category: r.category,
      tag: r.tag,
    }),
  );

  const csv = [CSV_HEADER, ...lines].join("\n") + "\n";
  // Scope the filename so multiple exports don't overwrite each other.
  const parts: string[] = [filters?.month ?? "all"];
  if (filters?.memberId) parts.push("member");
  if (filters?.tag) parts.push(filters.tag);
  if (filters?.uncategorized) parts.push("uncategorized");
  if (filters?.categoryId) parts.push("category");
  if (filters?.groupId) parts.push("group");
  if (filters?.from || filters?.to) parts.push("range");
  return { ok: true as const, csv, filename: `ledger-${parts.join("-")}-${todayInIST()}.csv` };
}
