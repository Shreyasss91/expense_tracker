import { TRANSACTION_TAGS } from "./constants";

/**
 * Pure snapshot diffing for the daily ledger-change feed's edit journal.
 *
 * `activity_log` had no update action before this feature (D4 was not
 * derivable from existing data), so the four writers in
 * src/actions/transactions.ts capture a **pre-image** before their UPDATE and
 * log a before/after pair. This module owns the "what actually changed?"
 * question so it is unit-testable and so the four call sites cannot drift.
 *
 * A row's `updated_at` column was considered and rejected: it can say that
 * something changed but not *what*, it collapses two edits in one window into
 * one line, and it disappears with the row if the row is later deleted — while
 * an activity-log entry survives and keeps edits to deleted rows reportable.
 */

export type TransactionTag = (typeof TRANSACTION_TAGS)[number];

export interface TransactionSnapshot {
  memberId: string;
  categoryId: string | null;
  tag: TransactionTag;
  amount: string; // NUMERIC string, exactly as Drizzle returns it (§5.8)
  note: string | null;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM:SS
  splitWith: string[];
}

/** The editable field set, in a stable order for deterministic rendering. */
export const TRACKED_FIELDS = [
  "amount",
  "note",
  "categoryId",
  "tag",
  "date",
  "time",
  "memberId",
  "splitWith",
] as const;

export type TrackedField = (typeof TRACKED_FIELDS)[number];

/** The row shape both a SELECT and an `UPDATE … RETURNING` produce. */
export interface SnapshotColumns {
  memberId: string;
  categoryId: string | null;
  tag: string;
  amount: string;
  note: string | null;
  date: string;
  time: string;
  splitWith: string[] | null;
}

/** Normalize a DB row (or a returning row) into a comparable snapshot. */
export function toSnapshot(row: SnapshotColumns): TransactionSnapshot {
  return {
    memberId: row.memberId,
    categoryId: row.categoryId ?? null,
    tag: row.tag as TransactionTag,
    amount: row.amount,
    note: row.note ?? null,
    date: row.date,
    time: row.time,
    splitWith: row.splitWith ?? [],
  };
}

/** Assignment is a set, not a list — order must not register as a change. */
function sameMembers(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

/** `450.00` vs `450.0` must not read as a change; compare numerically. */
function sameAmount(a: string, b: string): boolean {
  return Number(a) === Number(b);
}

/**
 * The field names that genuinely differ, in TRACKED_FIELDS order.
 *
 * A `null` pre-image yields `[]` — a row that could not be read is not a
 * change, and callers log nothing for it (an update whose row was not found
 * must not appear in the feed).
 */
export function diffSnapshots(
  before: TransactionSnapshot | null,
  after: TransactionSnapshot,
): TrackedField[] {
  if (!before) return [];
  const changed: TrackedField[] = [];
  for (const field of TRACKED_FIELDS) {
    switch (field) {
      case "amount":
        if (!sameAmount(before.amount, after.amount)) changed.push(field);
        break;
      case "splitWith":
        if (!sameMembers(before.splitWith, after.splitWith)) changed.push(field);
        break;
      case "note":
      case "categoryId":
      case "memberId":
      case "date":
      case "time":
      case "tag":
        if (before[field] !== after[field]) changed.push(field);
        break;
    }
  }
  return changed;
}
