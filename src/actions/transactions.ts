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

/**
 * §7.1 createTransaction — every mutating action must, before any write:
 *  1. Parse its payload with Zod (including the type/tag discriminated union).
 *  2. Verify the member exists in `members` (§3.2.1 — data integrity, not auth).
 *  3. Convert amounts at the paise boundary (§5.8).
 *  The member is read from the active_member_id cookie (§6.2 step 5) — the
 *  SOLE source, with no client-supplied fallback. The cookie value is
 *  validated as a UUID and the member verified to exist (§3.2.1).
 */
export async function createTransaction(raw: TransactionInput) {
  const parsed = transactionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid transaction data" };

  const data = parsed.data;

  // §3.2 / §6.2 step 5 — active_member_id is the sole source of the creating
  // member. No `activeMemberId ?? data.memberId` fallback. A missing or
  // malformed cookie is a clear, explicit error.
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
      id: randomUUID(), // Quick Add: random v4 (§8.1)
      memberId,
      categoryId: data.categoryId,
      type: data.type,
      tag: data.type === "expense" ? data.tag : null,
      amount: paiseToDbString(paise), // §5.8 paise → fixed-2-decimal string
      note: data.note ?? null,
      date: data.date,
      time: `${data.time}:00`, // §5.6 HH:MM → HH:MM:00 at the write boundary
    })
    .returning();

  revalidatePath("/");
  revalidatePath("/transactions");
  revalidateTag("transactions");

  // §6.7 — after an expense lands, check whether it left the month or its
  // category over budget; the client surfaces this as a toast.
  const alert: BudgetAlert | null =
    data.type === "expense" ? await getBudgetAlert(data.date.slice(0, 7), data.categoryId) : null;

  return { ok: true as const, id: row.id, alert };
}

export async function updateTransaction(id: string, raw: TransactionInput) {
  // §7.1 — the mutation id is validated at the action boundary, before any DB access.
  const idCheck = idSchema.safeParse(id);
  if (!idCheck.success) return { ok: false as const, error: "Invalid transaction id" };

  const parsed = transactionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid transaction data" };
  const data = parsed.data;

  const memberExists = await db.query.members.findFirst({ where: eq(members.id, data.memberId) });
  if (!memberExists) return { ok: false as const, error: "Unknown member" };
  const categoryExists = await db.query.categories.findFirst({ where: eq(categories.id, data.categoryId) });
  if (!categoryExists) return { ok: false as const, error: "Unknown category" };

  const [row] = await db
    .update(transactions)
    .set({
      memberId: data.memberId,
      categoryId: data.categoryId,
      type: data.type,
      tag: data.type === "expense" ? data.tag : null,
      amount: paiseToDbString(data.amount),
      note: data.note ?? null,
      date: data.date,
      time: `${data.time}:00`,
    })
    .where(eq(transactions.id, idCheck.data))
    .returning();

  revalidatePath("/");
  revalidatePath("/transactions");
  revalidateTag("transactions");

  // §6.7 — same over-budget check after an edit.
  const alert: BudgetAlert | null =
    data.type === "expense" ? await getBudgetAlert(data.date.slice(0, 7), data.categoryId) : null;

  return { ok: true as const, id: row?.id, alert };
}

/** §6.4.1 hard delete — no soft delete, no tombstones. */
export async function deleteTransaction(id: string) {
  // §7.1 — the mutation id is validated at the action boundary, before any DB access.
  const idCheck = idSchema.safeParse(id);
  if (!idCheck.success) return { ok: false as const, error: "Invalid transaction id" };

  await db.delete(transactions).where(eq(transactions.id, idCheck.data));
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidateTag("transactions");
  return { ok: true as const };
}

/**
 * §7.3 keyset pagination for infinite scroll. Fetches PAGE_SIZE + 1 rows to
 * detect whether another page exists; filters and search compose in SQL.
 */
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
      type: transactions.type,
      tag: transactions.tag,
      amount: transactions.amount,
      note: transactions.note,
      date: transactions.date,
      time: transactions.time,
      createdAt: transactions.createdAt,
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

/** §6.6 canonical CSV export — 8 columns, seed.csv order, date ASC / created_at ASC. */
export async function exportCsv(): Promise<{ ok: true; csv: string; filename: string } | { ok: false; error: string }> {
  const rows = await db
    .select({
      date: transactions.date,
      time: transactions.time,
      member: members.name,
      type: transactions.type,
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
      type: r.type,
      note: r.note,
      amount: r.amount,
      category: r.category,
      tag: r.tag,
    }),
  );

  const csv = [CSV_HEADER, ...lines].join("\n") + "\n";
  // §5.7 — the filename date is a calendar artifact derived in APP_TIMEZONE, never UTC.
  return { ok: true, csv, filename: `family-ledger-export-${todayInIST()}.csv` };
}
