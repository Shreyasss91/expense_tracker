"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { transactions, members, categories } from "@/db/schema";
import { listOrderBy, PAGE_SIZE, type Cursor } from "@/lib/query";
import { pendingReviewWhere } from "@/lib/review-where";
import { idSchema, reviewNoteSchema } from "@/lib/validations";

export interface ReviewItem {
  id: string;
  memberId: string;
  categoryId: string | null;
  tag: "one_time" | "recurring" | "lifestyle" | null;
  amount: string;
  note: string | null;
  date: string;
  time: string;
  createdAt: string;
  reviewedAt: string | null;
  member: { name: string; emoji: string; color: string; slug: string };
  /** NULL = uncategorized (Amendment 20). */
  category: { name: string; emoji: string; color: string; slug: string } | null;
}

/**
 * Get pending review items grouped by month (§6.4).
 * Queue = reviewed_at IS NULL AND (note is empty OR generic OR equals category name).
 * Returns items ordered by date DESC, time DESC, createdAt DESC, id DESC with keyset pagination.
 */
export async function getReviewPage(args: {
  cursor: Cursor | null;
}): Promise<{ rows: ReviewItem[]; nextCursor: Cursor | null }> {
  const whereClause = pendingReviewWhere(args.cursor);

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
    .innerJoin(members, sql`${transactions.memberId} = ${members.id}`)
    .leftJoin(categories, sql`${transactions.categoryId} = ${categories.id}`)
    .where(whereClause)
    .orderBy(...listOrderBy)
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const last = page[page.length - 1];

  return {
    rows: page.map((row) => ({
      id: row.id,
      memberId: row.memberId,
      categoryId: row.categoryId,
      tag: row.tag as ReviewItem["tag"],
      amount: row.amount,
      note: row.note,
      date: row.date,
      time: row.time,
      createdAt: row.createdAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      member: {
        name: row.memberName,
        emoji: row.memberEmoji,
        color: row.memberColor,
        slug: row.memberSlug,
      },
      category:
        row.categoryId && row.categoryName
          ? {
              name: row.categoryName,
              emoji: row.categoryEmoji ?? "🏷️",
              color: row.categoryColor ?? "#9ca3af",
              slug: row.categorySlug ?? "",
            }
          : null,
    })),
    nextCursor:
      hasMore && last
        ? { date: last.date, time: last.time, createdAt: last.createdAt.toISOString(), id: last.id }
        : null,
  };
}

export async function updateReviewNote(id: string, rawNote: string | null) {
  const idCheck = idSchema.safeParse(id);
  if (!idCheck.success) return { ok: false as const, error: "Invalid transaction id" };
  const note = reviewNoteSchema.safeParse(rawNote);
  if (!note.success) return { ok: false as const, error: "Note must be 140 characters or fewer" };

  const [row] = await db
    .update(transactions)
    .set({ note: note.data, reviewedAt: null })
    .where(eq(transactions.id, idCheck.data))
    .returning({ id: transactions.id });
  if (!row) return { ok: false as const, error: "Transaction not found" };

  revalidatePath("/review");
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidateTag("transactions");
  return { ok: true as const };
}
