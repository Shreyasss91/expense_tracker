import { and, eq, lt, or, sql, type SQL } from "drizzle-orm";
import { transactions, categories } from "@/db/schema";
import { GENERIC_NOTE_BLOCKLIST } from "@/lib/generic-notes";
import type { Cursor } from "@/lib/query";

const genericNotes = [...GENERIC_NOTE_BLOCKLIST].map((note) => sql`${note}`);

/** The Review queue predicate shared by the page and its badge count. */
export function pendingReviewWhere(cursor: Cursor | null = null): SQL {
  const cursorWhere = cursor
    ? or(
        lt(transactions.date, cursor.date),
        and(eq(transactions.date, cursor.date), lt(transactions.time, cursor.time)),
        and(eq(transactions.date, cursor.date), eq(transactions.time, cursor.time), lt(transactions.createdAt, new Date(cursor.createdAt))),
        and(
          eq(transactions.date, cursor.date),
          eq(transactions.time, cursor.time),
          eq(transactions.createdAt, new Date(cursor.createdAt)),
          lt(transactions.id, cursor.id),
        ),
      )
    : undefined;

  // The "redundant note" clause is a self-contained EXISTS so the predicate
  // works both with and without a `categories` join in the outer query (the
  // badge count selects from transactions alone). With nullable
  // category_id (Amendment 20) an uncategorized row simply never matches
  // this branch — it can't be "equal to its category name".
  const genericNote = sql`(
    ${transactions.note} IS NULL
    OR btrim(${transactions.note}) = ''
    OR lower(btrim(${transactions.note})) IN (${sql.join(genericNotes, sql`, `)})
    OR EXISTS (
      SELECT 1 FROM ${categories}
      WHERE ${categories.id} = ${transactions.categoryId}
        AND lower(btrim(${categories.name})) = lower(btrim(${transactions.note}))
    )
  )`;

  return and(sql`${transactions.reviewedAt} IS NULL`, genericNote, cursorWhere)!;
}
