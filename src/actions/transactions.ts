"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { cookies } from "next/headers";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, members, transactions } from "@/db/schema";
import { paiseToDbString } from "@/lib/money";
import { todayInIST } from "@/lib/dates";
import { idSchema, transactionSchema, type TransactionInput } from "@/lib/validations";
import { buildWhere, listOrderBy, mapRow, PAGE_SIZE, type Cursor, type TransactionListFilters } from "@/lib/query";
import { CSV_HEADER, formatCsvLine } from "@/lib/csv-export";
import { getBudgetAlert } from "@/lib/budgets";
import type { BudgetAlert } from "@/lib/budget-alert";
import { isGenericNote } from "@/lib/generic-notes";
import { pendingReviewWhere } from "@/lib/review-where";

export async function createTransaction(raw: TransactionInput) {
  const parsed = transactionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid transaction data" };

  const data = parsed.data;
  const cookieStore = await cookies();
  const activeMemberId = cookieStore.get("active_member_id")?.value;
  const memberIdCheck = idSchema.safeParse(activeMemberId);
  if (!memberIdCheck.success) {
    return { ok: false as const, error: "No active member selected — pick a member in the header" };
  }
  const memberId = memberIdCheck.data;

  const memberExists = await db.query.members.findFirst({ where: eq(members.id, memberId) });
  if (!memberExists) return { ok: false as const, error: "Unknown member" };

  const categoryExists = await db.query.categories.findFirst({ where: eq(categories.id, data.categoryId) });
  if (!categoryExists) return { ok: false as const, error: "Unknown category" };

  const paise = data.amount;

  const [row] = await db
    .insert(transactions)
    .values({
      id: randomUUID(),
      memberId,
      categoryId: data.categoryId,
      tag: data.tag,
      amount: paiseToDbString(paise),
      note: data.note ?? null,
      date: data.date,
      time: `${data.time}:00`,
      reviewedAt: isGenericNote(data.note ?? null) ? null : undefined, // NULL for generic notes (§6.4)
    })
    .returning();

  revalidatePath("/");
  revalidatePath("/transactions");
  revalidateTag("transactions");

  const alert: BudgetAlert | null = await getBudgetAlert(db, data.date.slice(0, 7), data.categoryId);

  return { ok: true as const, id: row.id, alert };
}

export async function updateTransaction(id: string, raw: TransactionInput) {
  const idCheck = idSchema.safeParse(id);
  if (!idCheck.success) return { ok: false as const, error: "Invalid transaction id" };

  const parsed = transactionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid transaction data" };
  const data = parsed.data;

  const memberExists = await db.query.members.findFirst({ where: eq(members.id, data.memberId) });
  if (!memberExists) return { ok: false as const, error: "Unknown member" };
  const categoryExists = await db.query.categories.findFirst({ where: eq(categories.id, data.categoryId) });
  if (!categoryExists) return { ok: false as const, error: "Unknown category" };

  const [existing] = await db
    .select({ note: transactions.note })
    .from(transactions)
    .where(eq(transactions.id, idCheck.data));
  const noteChanged = (existing?.note ?? null) !== (data.note ?? null);

  const [row] = await db
    .update(transactions)
    .set({
      memberId: data.memberId,
      categoryId: data.categoryId,
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

  const alert: BudgetAlert | null = await getBudgetAlert(db, data.date.slice(0, 7), data.categoryId);

  return { ok: true as const, id: row.id, alert };
}

export async function deleteTransaction(id: string) {
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

/** Get pending review count for the badge (§6.4). */
export async function getPendingReviewCount(): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(pendingReviewWhere());
  return Number(result[0]?.count ?? 0);
}

export async function getTransactionsPage(args: {
  cursor: Cursor | null;
  filters: TransactionListFilters;
}): Promise<{ rows: ReturnType<typeof mapRow>[]; nextCursor: Cursor | null }> {
  const where = buildWhere(args.filters, args.cursor);

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
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
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

export async function exportCsv(): Promise<{ ok: true; csv: string; filename: string } | { ok: false; error: string }> {
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
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .orderBy(sql`date ASC, created_at ASC`);

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
  return { ok: true, csv, filename: `family-ledger-export-${todayInIST()}.csv` };
}
