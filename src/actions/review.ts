"use server";

import { auth } from "@/auth";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { transactions, members, categories } from "@/db/schema";
import { listOrderBy, PAGE_SIZE, receiptCountExpr, type Cursor, type TransactionListRow } from "@/lib/query";
import { pendingReviewWhere } from "@/lib/review-where";

/**
 * A review item is the same row the ledger renders — the queue is a filtered
 * view of `transactions`, not a different entity. Aliasing the ledger's row
 * type (rather than re-declaring the shape) is what lets the Review queue hand
 * a row straight to the shared edit dialog without a conversion layer, and it
 * means a new row field is picked up here automatically.
 */
export type ReviewItem = TransactionListRow;

/**
 * Get pending review items grouped by month (§6.4).
 * Queue = reviewed_at IS NULL AND (note is empty OR generic OR equals category name).
 * Returns items ordered by date DESC, time DESC, createdAt DESC, id DESC with keyset pagination.
 */
export async function getReviewPage(args: {
  cursor: Cursor | null;
}): Promise<{ rows: ReviewItem[]; nextCursor: Cursor | null }> {
  const session = await auth();
  if (!session?.user) return { rows: [], nextCursor: null };
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
      shared: transactions.shared,
      splitWith: transactions.splitWith,
      // §2.9 — so a review row can carry its paperclip into the edit dialog.
      receiptCount: receiptCountExpr,
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
      shared: row.shared,
      splitWith: row.splitWith ?? [],
      receiptCount: Number(row.receiptCount ?? 0),
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
