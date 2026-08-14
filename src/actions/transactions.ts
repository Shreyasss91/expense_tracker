"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { cookies } from "next/headers";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, members, transactions } from "@/db/schema";
import { paiseToDbString } from "@/lib/money";
import { transactionSchema, type TransactionInput } from "@/lib/validations";
import { buildWhere, listOrderBy, mapRow, PAGE_SIZE, type Cursor, type TransactionListFilters } from "@/lib/query";

/**
 * §7.1 createTransaction — every mutating action must, before any write:
 *  1. Parse its payload with Zod (including the type/tag discriminated union).
 *  2. Verify the member exists in `members` (§3.2.1 — data integrity, not auth).
 *  3. Convert amounts at the paise boundary (§5.8).
 *  The member_id is read from the active_member_id cookie (§6.2 step 5) and
 *  validated against the members table — never trusted from the client.
 */
export async function createTransaction(raw: TransactionInput) {
  const parsed = transactionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid transaction data" };

  const data = parsed.data;

  const cookieStore = await cookies();
  const activeMemberId = cookieStore.get("active_member_id")?.value;
  const memberId = activeMemberId ?? data.memberId;

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

  return { ok: true as const, id: row.id };
}

export async function updateTransaction(id: string, raw: TransactionInput) {
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
    .where(eq(transactions.id, id))
    .returning();

  revalidatePath("/");
  revalidatePath("/transactions");
  revalidateTag("transactions");

  return { ok: true as const, id: row?.id };
}

/** §6.4.1 hard delete — no soft delete, no tombstones. */
export async function deleteTransaction(id: string) {
  await db.delete(transactions).where(eq(transactions.id, id));
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

  const header = "date,time,member,type,item,amount,category,tag";
  const lines = rows.map((r) =>
    [
      r.date,
      r.time.slice(0, 5), // §5.6 HH:MM display form
      r.member,
      r.type,
      r.note ?? "",
      Number(r.amount).toFixed(2), // plain 2-dp decimal, no grouping (§6.6)
      r.category,
      r.type === "expense" ? (r.tag ?? "") : "", // tag empty for income (§6.6)
    ]
      .map((f) => (typeof f === "string" ? f : String(f)))
      .join(","),
  );

  const csv = [header, ...lines].join("\n") + "\n";
  return { ok: true, csv, filename: `family-ledger-export-${new Date().toISOString().slice(0, 10)}.csv` };
}
