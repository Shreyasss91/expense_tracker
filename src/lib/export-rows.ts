import "server-only";

/**
 * §2.10 — the query side of export/backup: a bounded, batched row iterator.
 *
 * The pre-§2.10 `exportCsv` ran one unbounded SELECT and then joined the whole
 * result into a single JS string. Two separate failure modes:
 *
 *   1. Memory — N rows × ~10 fields held at once, then a second copy inside
 *      the joined string. A serverless function OOMs well before a decade of
 *      household entries does.
 *   2. No ceiling — nothing stopped a mistaken "export everything" from
 *      trying to return hundreds of megabytes.
 *
 * This module fixes both: rows are fetched EXPORT_BATCH_SIZE at a time through
 * a keyset cursor (no OFFSET drift, index-backed), yielded to the caller so a
 * stream can push them out and drop them, and stopped hard at EXPORT_ROW_CAP.
 *
 * Ordering is the same total order the ledger list uses, ascending —
 * (date, time, created_at, id) — so an export is byte-reproducible and
 * re-importable.
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { attachments, categories, members, transactions } from "@/db/schema";
import { buildWhere, expandGroupFilter, type TransactionListFilters } from "@/lib/query";
import { EXPORT_BATCH_SIZE, EXPORT_ROW_CAP, type ExportRow } from "@/lib/export-format";

export interface ExportQueryOptions {
  /** Rows per round-trip. Defaults to EXPORT_BATCH_SIZE. */
  batchSize?: number;
  /** Hard stop. Defaults to EXPORT_ROW_CAP. */
  cap?: number;
}

export interface ExportCollection {
  rows: ExportRow[];
  /** True when the cap stopped the scan — the export is incomplete. */
  truncated: boolean;
}

/** Keyset position in the (date, time, created_at, id) total order. */
interface RowCursor {
  date: string;
  time: string;
  createdAt: Date;
  id: string;
}

/**
 * Row-value comparison — `(a, b, c) > (x, y, z)` — is a single index-friendly
 * predicate, unlike the five-way OR/AND expansion the ledger's DESC cursor
 * needs. Explicit casts: the driver sends these as unknown-typed parameters,
 * and Postgres cannot infer the row type without them.
 */
function afterCursor(cursor: RowCursor | null): SQL | undefined {
  if (!cursor) return undefined;
  return sql`(${transactions.date}, ${transactions.time}, ${transactions.createdAt}, ${transactions.id}) > (${cursor.date}::date, ${cursor.time}::time, ${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`;
}

const parentCategory = alias(categories, "parent_category");

/** One joined row, exactly as the driver returns it (timestamps still Dates). */
interface RawExportRow {
  id: string;
  date: string;
  time: string;
  note: string | null;
  amount: string;
  tag: ExportRow["tag"];
  reviewedAt: Date | null;
  createdAt: Date;
  shared: boolean;
  splitWith: string[] | null;
  memberName: string;
  memberSlug: string;
  categoryName: string | null;
  categorySlug: string | null;
  groupName: string | null;
}

/**
 * One batch. A named function with an explicit return type rather than an
 * inline `await db.select(...)`: the loop below feeds its own last row back in
 * as the next cursor, and an inline initializer would make that a circular
 * inference for TypeScript.
 */
async function fetchBatch(base: SQL | undefined, cursor: RowCursor | null, take: number): Promise<RawExportRow[]> {
  return db
    .select({
      id: transactions.id,
      date: transactions.date,
      time: transactions.time,
      note: transactions.note,
      amount: transactions.amount,
      tag: transactions.tag,
      reviewedAt: transactions.reviewedAt,
      createdAt: transactions.createdAt,
      shared: transactions.shared,
      splitWith: transactions.splitWith,
      memberName: members.name,
      memberSlug: members.slug,
      categoryName: categories.name,
      categorySlug: categories.slug,
      // Two-level hierarchy: the group is the leaf's parent (§2.1).
      groupName: parentCategory.name,
    })
    .from(transactions)
    .innerJoin(members, eq(transactions.memberId, members.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(parentCategory, eq(categories.parentId, parentCategory.id))
    .where(and(base, afterCursor(cursor)))
    .orderBy(sql`${transactions.date} ASC, ${transactions.time} ASC, ${transactions.createdAt} ASC, ${transactions.id} ASC`)
    .limit(take);
}

/**
 * Yield batches of export rows in ascending ledger order. Stops after `cap`
 * rows in total (the caller learns about truncation from the collection
 * helper, or by counting what it received).
 */
export async function* iterateExportRows(
  filters: TransactionListFilters,
  options: ExportQueryOptions = {},
): AsyncGenerator<ExportRow[]> {
  const batchSize = Math.max(1, Math.min(options.batchSize ?? EXPORT_BATCH_SIZE, 2_000));
  const cap = Math.max(1, options.cap ?? EXPORT_ROW_CAP);
  const base = buildWhere(await expandGroupFilter(filters), null);

  // Members are a handful of rows — resolve ids → slugs once, up front, so
  // split_with can be exported as stable slugs instead of opaque uuids.
  const memberRows = await db.select({ id: members.id, slug: members.slug }).from(members);
  const slugById = new Map(memberRows.map((m) => [m.id, m.slug]));

  let cursor: RowCursor | null = null;
  let emitted = 0;

  while (emitted < cap) {
    const take = Math.min(batchSize, cap - emitted);
    const rows = await fetchBatch(base, cursor, take);

    if (rows.length === 0) return;

    // Receipts for this batch only — one IN() query, never N queries.
    const ids = rows.map((r) => r.id);
    const attachmentRows = await db
      .select({
        transactionId: attachments.transactionId,
        pathname: attachments.pathname,
        contentType: attachments.contentType,
        sizeBytes: attachments.sizeBytes,
      })
      .from(attachments)
      .where(inArray(attachments.transactionId, ids));

    const byTransaction = new Map<string, ExportRow["attachments"]>();
    for (const a of attachmentRows) {
      const list = byTransaction.get(a.transactionId) ?? [];
      list.push({ pathname: a.pathname, contentType: a.contentType, sizeBytes: a.sizeBytes });
      byTransaction.set(a.transactionId, list);
    }

    const batch: ExportRow[] = rows.map((r) => ({
      id: r.id,
      date: r.date,
      time: r.time,
      member: r.memberName,
      memberSlug: r.memberSlug,
      note: r.note,
      amount: r.amount,
      category: r.categoryName,
      categorySlug: r.categorySlug,
      group: r.groupName,
      tag: r.tag,
      shared: r.shared,
      // Ids are meaningless outside this database; slugs are the portable form.
      splitWith: (r.splitWith ?? []).map((id) => slugById.get(id) ?? id),
      reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      attachments: byTransaction.get(r.id) ?? [],
    }));

    yield batch;

    emitted += batch.length;
    const last = rows[rows.length - 1];
    cursor = { date: last.date, time: last.time, createdAt: last.createdAt, id: last.id };

    // A short batch means the scan is finished — don't pay for another hop.
    if (rows.length < take) return;
  }
}

/**
 * How many rows an export would produce. One cheap COUNT(*) on the same WHERE
 * the iterator uses, run *before* the stream starts so the response can carry
 * accurate `X-Export-Rows` / `X-Export-Truncated` headers — headers have to be
 * committed before the first byte, and a truncation the caller never learns
 * about is worse than an extra round-trip.
 */
export async function countExportRows(filters: TransactionListFilters): Promise<number> {
  const where = buildWhere(await expandGroupFilter(filters), null);
  const rows = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(transactions)
    .where(where);
  return Number(rows[0]?.count ?? 0);
}

/**
 * Materialise the whole export. Used where the format genuinely cannot be
 * streamed (XLSX — its ZIP central directory records sizes that are only known
 * once every entry is written, see src/lib/zip.ts) and by the monthly backup.
 * Bounded by `cap` exactly like the iterator.
 */
export async function collectExportRows(
  filters: TransactionListFilters,
  options: ExportQueryOptions = {},
): Promise<ExportCollection> {
  const cap = Math.max(1, options.cap ?? EXPORT_ROW_CAP);
  const rows: ExportRow[] = [];
  for await (const batch of iterateExportRows(filters, { ...options, cap })) {
    rows.push(...batch);
  }
  return { rows, truncated: rows.length >= cap };
}
