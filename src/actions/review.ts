"use server";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { transactions, members, categories } from "@/db/schema";
import { PAGE_SIZE, type Cursor } from "@/lib/query";
import { isGenericNote } from "@/lib/generic-notes";

export interface ReviewItem {
  id: string;
  memberId: string;
  categoryId: string;
  tag: "one_time" | "recurring" | "lifestyle" | null;
  amount: string;
  note: string | null;
  date: string;
  time: string;
  createdAt: string;
  reviewedAt: string | null;
  member: { name: string; emoji: string; color: string; slug: string };
  category: { name: string; emoji: string; color: string; slug: string };
}

/**
 * Get pending review items grouped by month (§6.4).
 * Queue = reviewed_at IS NULL AND (note is empty OR generic OR equals category name).
 * Returns items ordered by date DESC, time DESC, createdAt DESC, id DESC with keyset pagination.
 */
export async function getReviewPage(args: {
  cursor: Cursor | null;
}): Promise<{ rows: ReviewItem[]; nextCursor: Cursor | null }> {
  const whereClause = sql`${transactions.reviewedAt} IS NULL`;

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
    .innerJoin(categories, sql`${transactions.categoryId} = ${categories.id}`)
    .where(whereClause)
    .orderBy(sql`${transactions.date} DESC`, sql`${transactions.time} DESC`, sql`${transactions.createdAt} DESC`, sql`${transactions.id} DESC`)
    .limit(PAGE_SIZE + 1);

  // Filter for generic notes in-memory (blocklist + category name check)
  const filteredRows = rows.filter((row) => {
    const normalizedNote = row.note ? row.note.toLowerCase().trim() : "";
    const isEmptyOrGeneric =
      !row.note ||
      row.note.trim() === "" ||
      isGenericNote(row.note) ||
      normalizedNote === row.categoryName.toLowerCase();
    return isEmptyOrGeneric;
  });

  const hasMore = filteredRows.length > PAGE_SIZE;
  const page = hasMore ? filteredRows.slice(0, PAGE_SIZE) : filteredRows;
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
      category: {
        name: row.categoryName,
        emoji: row.categoryEmoji,
        color: row.categoryColor,
        slug: row.categorySlug,
      },
    })),
    nextCursor:
      hasMore && last
        ? { date: last.date, time: last.time, createdAt: last.createdAt.toISOString(), id: last.id }
        : null,
  };
}
