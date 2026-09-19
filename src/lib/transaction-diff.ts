import { TRANSACTION_TAGS } from "./constants";

/**
 * Pure snapshot mapping for the daily ledger-change feed's edit journal — the
 * row → snapshot direction used to detect changes, and the snapshot → row
 * direction used to restore a deleted one.
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

/** `undefined` for anything that is not a usable non-empty string. */
function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** A jsonb timestamp round-trips as an ISO string; only a parseable value is usable. */
function restoreTimestamp(value: unknown): Date | undefined {
  if (typeof value !== "string" && !(value instanceof Date)) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** The row columns a restore writes back, derived from a delete snapshot. */
export interface RestoreInsertValues {
  id: string;
  memberId: string;
  categoryId: string | null;
  tag: TransactionTag;
  amount: string;
  note: string | null;
  date: string;
  time: string;
  shared: boolean;
  splitWith: string[];
  /** Omitted — so the column default applies — when the snapshot carries no usable instant. */
  createdAt?: Date;
}

/**
 * The inverse of `toSnapshot`, and the only place a delete snapshot is turned
 * back into an insert.
 *
 * It exists as its own function because a restore must be **faithful**: a delete
 * snapshot carries the row's `created_at`, and re-inserting without it (letting
 * `defaultNow()` fire) stamps the row with the *restore* instant instead of the
 * original one. That is not cosmetic — the daily feed decides window membership
 * on `created_at`, so an unfaithful restore shows a deleted-and-undone expense
 * as a brand-new **Added** entry, and D6 ("a delete plus its Undo reports
 * neither") could never hold. See SPEC_DAILY_LEDGER_WHATSAPP_FEED §5.4.4 step 3,
 * whose "only if its own created_at falls inside the window" presumes exactly
 * this preservation.
 *
 * Returns `null` for a snapshot that cannot be re-inserted — the caller skips
 * it, which is the behaviour the previous inline insert already produced through
 * its try/catch.
 */
export function restoreValuesFromSnapshot(snapshot: Record<string, unknown>): RestoreInsertValues | null {
  const id = nonEmptyString(snapshot.id);
  const memberId = nonEmptyString(snapshot.memberId);
  const amount = nonEmptyString(snapshot.amount);
  const date = nonEmptyString(snapshot.date);
  const time = nonEmptyString(snapshot.time);
  if (!id || !memberId || !amount || !date || !time) return null;

  const tag = nonEmptyString(snapshot.tag);
  if (!tag || !(TRANSACTION_TAGS as readonly string[]).includes(tag)) return null;

  return {
    id,
    memberId,
    categoryId: nonEmptyString(snapshot.categoryId),
    tag: tag as TransactionTag,
    amount,
    date,
    time,
    note: typeof snapshot.note === "string" ? snapshot.note : null,
    shared: snapshot.shared === true,
    splitWith: Array.isArray(snapshot.splitWith)
      ? snapshot.splitWith.filter((value): value is string => typeof value === "string")
      : [],
    createdAt: restoreTimestamp(snapshot.createdAt),
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
