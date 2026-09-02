import "server-only";

/**
 * §2.10 — the DB half of the import path.
 *
 * Kept out of the Route Handler and out of a Server Action for two reasons:
 *
 *   1. Server Actions cap their request body at 1 MB by default, and a backup
 *      file is allowed to be 5 MB. A Route Handler has no such cap.
 *   2. Preview and commit must resolve names → ids identically. If they
 *      didn't, the preview could promise 412 rows and the commit could insert
 *      400 — so both modes call this one resolver and only differ at the end.
 *
 * Name resolution is deliberately forgiving: it matches member/category by
 * slug first, then by display name (case-insensitively), because a household
 * that renamed "Dad" → "Appa" between backup and restore should still restore.
 * Only LEAF categories are candidates — a group is never assignable (§2.1).
 *
 * An unresolved MEMBER is fatal for that row (an entry with nobody attached is
 * meaningless). An unresolved CATEGORY is not: the row imports uncategorized
 * and is reported, because losing the rupees is worse than losing the label.
 */
import { randomUUID } from "node:crypto";
import { and, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { categories, members, transactions, type NewTransaction } from "@/db/schema";
import {
  importFingerprint,
  isImportable,
  parseImportFile,
  type ImportDraftRow,
} from "@/lib/ledger-import";
import type { ImportIssue, ImportSource, ImportSummary } from "./import-types";

export type { ImportIssue, ImportSource, ImportSummary } from "./import-types";

export interface ImportResolution {
  fatal?: string;
  summary: ImportSummary;
  insertable: NewTransaction[];
}

/** Rows per INSERT — keeps one statement inside a sane parameter count. */
const INSERT_CHUNK = 500;

interface Directory {
  memberBySlug: Map<string, string>;
  memberByName: Map<string, string>;
  categoryBySlug: Map<string, string>;
  categoryByName: Map<string, string>;
}

async function loadDirectory(): Promise<Directory> {
  const [memberRows, categoryRows] = await Promise.all([
    db.select({ id: members.id, slug: members.slug, name: members.name }).from(members),
    // Leaves only — a group row is a roll-up, never an assignment target.
    db
      .select({ id: categories.id, slug: categories.slug, name: categories.name })
      .from(categories)
      .where(isNotNull(categories.parentId)),
  ]);
  const lower = (v: string) => v.trim().toLowerCase();
  return {
    memberBySlug: new Map(memberRows.map((m) => [lower(m.slug), m.id])),
    memberByName: new Map(memberRows.map((m) => [lower(m.name), m.id])),
    categoryBySlug: new Map(categoryRows.map((c) => [lower(c.slug), c.id])),
    categoryByName: new Map(categoryRows.map((c) => [lower(c.name), c.id])),
  };
}

/**
 * Which rows of this file are already in the database.
 *
 * Two passes, because the two file shapes carry different identity:
 *   - JSON / extended CSV carry `id` → a direct primary-key probe.
 *   - canonical CSV carries nothing → a natural-key probe over the file's own
 *     date span (date, time, member, amount, note), which is exactly what the
 *     exporter emits, so re-running the same restore is a no-op.
 */
async function findExisting(
  rows: ImportDraftRow[],
  directory: Directory,
  memberIdOf: (row: ImportDraftRow) => string | null,
): Promise<Set<number>> {
  const present = new Set<number>();

  const withIds = rows.flatMap((row, index) => (row.id ? [{ index, id: row.id }] : []));
  if (withIds.length > 0) {
    const found = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(inArray(transactions.id, withIds.map((r) => r.id)));
    const known = new Set(found.map((r) => r.id));
    for (const entry of withIds) if (known.has(entry.id)) present.add(entry.index);
  }

  const needFingerprint = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) => !row.id && row.issues.length === 0 && !present.has(index));

  if (needFingerprint.length === 0) return present;

  const dates = needFingerprint.map(({ row }) => row.date).sort();
  const start = dates[0];
  const end = dates[dates.length - 1];
  const existing = await db
    .select({
      date: transactions.date,
      time: transactions.time,
      memberId: transactions.memberId,
      amount: transactions.amount,
      note: transactions.note,
    })
    .from(transactions)
    .where(and(gte(transactions.date, start), lte(transactions.date, end)));

  const seen = new Set(
    existing.map((r) =>
      importFingerprint({
        date: r.date,
        // The exporter writes HH:MM; the column stores HH:MM:SS.
        time: r.time.slice(0, 5),
        memberId: r.memberId,
        amount: r.amount,
        note: r.note,
      }),
    ),
  );

  for (const { row, index } of needFingerprint) {
    const memberId = memberIdOf(row);
    if (!memberId) continue;
    if (seen.has(importFingerprint({ date: row.date, time: row.time, memberId, amount: row.amount, note: row.note }))) {
      present.add(index);
    }
  }

  return present;
}

/**
 * Parse + resolve an uploaded backup into insertable rows. This is the whole
 * preview; the commit runs the same function and then inserts.
 */
export async function resolveImport(filename: string, text: string): Promise<ImportResolution> {
  const parsed = parseImportFile(filename, text);

  const emptySummary = (source: ImportSource): ImportSummary => ({
    source,
    total: 0,
    blankRows: 0,
    invalid: 0,
    unresolvedMember: 0,
    unresolvedCategory: 0,
    duplicate: 0,
    ready: 0,
    attachmentsReferenced: 0,
    issues: [],
    unresolvedMemberNames: [],
    unresolvedCategoryNames: [],
  });

  if (parsed.fatal) {
    return { fatal: parsed.fatal, summary: emptySummary(parsed.source), insertable: [] };
  }

  const directory = await loadDirectory();
  const lower = (v: string) => v.trim().toLowerCase();

  const memberIdOf = (row: ImportDraftRow): string | null => {
    const bySlug = row.memberSlug ? directory.memberBySlug.get(lower(row.memberSlug)) : undefined;
    if (bySlug) return bySlug;
    if (row.member) return directory.memberByName.get(lower(row.member)) ?? directory.memberBySlug.get(lower(row.member)) ?? null;
    return null;
  };

  const issues: ImportIssue[] = [];
  const unresolvedMemberNames = new Set<string>();
  const unresolvedCategoryNames = new Set<string>();
  const resolvedMemberIds: (string | null)[] = [];

  let invalid = 0;
  let unresolvedMember = 0;
  let unresolvedCategory = 0;
  let attachmentsReferenced = 0;

  parsed.rows.forEach((row) => {
    for (const message of row.issues) issues.push({ row: row.rowNumber, message });
    if (!isImportable(row)) {
      invalid += 1;
      resolvedMemberIds.push(null);
      return;
    }

    attachmentsReferenced += row.attachments.length;

    const memberId = memberIdOf(row);
    resolvedMemberIds.push(memberId);
    if (!memberId) {
      unresolvedMember += 1;
      unresolvedMemberNames.add(row.member ?? row.memberSlug ?? "(blank)");
      issues.push({ row: row.rowNumber, message: `unknown member "${row.member ?? row.memberSlug ?? ""}"` });
      return;
    }

    // An absent category is a legitimate "uncategorized" — only a *named* one
    // that fails to resolve is worth reporting.
    const wanted = row.categorySlug || row.category;
    if (wanted) {
      const categoryId =
        directory.categoryBySlug.get(lower(row.categorySlug ?? "")) ??
        directory.categoryBySlug.get(lower(wanted)) ??
        directory.categoryByName.get(lower(wanted));
      if (!categoryId) {
        unresolvedCategory += 1;
        unresolvedCategoryNames.add(wanted);
        issues.push({ row: row.rowNumber, message: `unknown category "${wanted}" — importing uncategorized` });
      }
    }
  });

  const existing = await findExisting(parsed.rows, directory, memberIdOf);

  const insertable: NewTransaction[] = [];
  let duplicate = 0;

  parsed.rows.forEach((row, index) => {
    if (!isImportable(row)) return;
    const memberId = resolvedMemberIds[index];
    if (!memberId) return;
    if (existing.has(index)) {
      duplicate += 1;
      return;
    }

    const wanted = row.categorySlug || row.category;
    const categoryId = wanted
      ? (directory.categoryBySlug.get(lower(row.categorySlug ?? "")) ??
        directory.categoryBySlug.get(lower(wanted)) ??
        directory.categoryByName.get(lower(wanted)) ??
        null)
      : null;

    // split_with stores member ids; the file carries slugs (the portable form).
    const splitWith = row.shared
      ? row.splitWith.map((slug) => directory.memberBySlug.get(lower(slug))).filter((id): id is string => Boolean(id))
      : [];

    insertable.push({
      // A JSON/extended restore keeps its original id, so re-running it is
      // idempotent on the primary key. A canonical CSV has no ids, so a fresh
      // one is minted and identity falls to the natural-key check above.
      id: row.id ?? randomUUID(),
      memberId,
      categoryId,
      tag: row.tag,
      amount: row.amount,
      note: row.note,
      date: row.date,
      // §5.6 — HH:MM at the boundary becomes HH:MM:00 at the write edge.
      time: `${row.time}:00`,
      shared: row.shared,
      splitWith,
      ...(row.reviewedAt ? { reviewedAt: new Date(row.reviewedAt) } : {}),
    });
  });

  const ready = insertable.length;

  return {
    summary: {
      source: parsed.source,
      total: parsed.rows.length,
      blankRows: parsed.blankRows,
      invalid,
      unresolvedMember,
      unresolvedCategory,
      duplicate,
      ready,
      attachmentsReferenced,
      // Preview is a report, not a log — 25 problems is plenty to act on.
      issues: issues.slice(0, 25),
      unresolvedMemberNames: [...unresolvedMemberNames].slice(0, 10),
      unresolvedCategoryNames: [...unresolvedCategoryNames].slice(0, 10),
    },
    insertable,
  };
}

/**
 * Insert the resolved rows. `onConflictDoNothing` is the safety net: if two
 * tabs commit the same backup at once, the second one's rows collide on the
 * primary key and are dropped rather than duplicating the ledger.
 *
 * Receipt bytes are NOT restored — they live in object storage, not in the
 * backup (see attachmentsReferenced in the summary). A restore recovers the
 * numbers and the metadata; photos have to be re-attached.
 */
export async function commitImport(insertable: NewTransaction[]): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  for (let i = 0; i < insertable.length; i += INSERT_CHUNK) {
    const chunk = insertable.slice(i, i + INSERT_CHUNK);
    const result = await db.insert(transactions).values(chunk).onConflictDoNothing();
    inserted += result.rowCount ?? chunk.length;
  }
  return { inserted, skipped: insertable.length - inserted };
}
