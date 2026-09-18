import "server-only";

import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityLog, categories, members, transactions } from "@/db/schema";
import { getAppSetting, setAppSetting } from "@/db/app-settings-mutations";
import { TRANSACTION_TAGS } from "@/lib/constants";
import { rupeesToPaise } from "@/lib/money";
import type { TransactionSnapshot, TransactionTag } from "@/lib/transaction-diff";
import {
  buildFeedChanges,
  type FeedAddedRow,
  type FeedCategoryRef,
  type FeedDeletedRow,
  type FeedEditedRow,
  type FeedMergeSummary,
  type LedgerFeed,
} from "./ledger-feed-format";
import type { FeedWindow } from "./ledger-feed-window";

/**
 * The daily ledger-change feed's DB layer. The pure rendering lives in
 * ledger-feed-format.ts and the window math in ledger-feed-window.ts, both
 * re-exported here so callers keep a single import — the same split
 * digest.ts / digest-format.ts uses.
 *
 * Membership is decided by `transactions.created_at` (the audit instant), never
 * by the business `date`/`time`: the feed answers "what changed in the ledger
 * since last night", which is why a backdated expense entered tonight belongs
 * to tonight's window and the closing total says "Entered in this window".
 */

export {
  buildFeedChanges,
  buildLedgerFeedMessage,
  categoryLabel,
  isFeedKey,
  sanitizeWhatsAppText,
  UNCATEGORIZED_LABEL,
  MAX_MESSAGE_CHARS,
  MAX_SECTION_ROWS,
  NOTE_MAX_CHARS,
} from "./ledger-feed-format";
export type {
  FeedAddedRow,
  FeedCategoryRef,
  FeedChange,
  FeedDeletedRow,
  FeedEditedRow,
  FeedMergeSummary,
  LedgerFeed,
} from "./ledger-feed-format";
export {
  FEED_GRACE_MS,
  FEED_HOUR_IST,
  FEED_KEY_RE,
  feedKeyHasEnded,
  feedWindowForInstant,
  parseFeedKey,
  windowKeyLabel,
} from "./ledger-feed-window";
export type { FeedKeyWindow, FeedWindow } from "./ledger-feed-window";

/* --------------------------------------------------------- app_settings ---- */

/**
 * §5.6 — the feed's three settings keys.
 *
 * A **distinct channel segment** (`whatsapp_feed`) deliberately keeps this
 * history out of the weekly/monthly digest's `digest_sent:whatsapp:<period>`
 * namespace: the two keys look nothing alike and cannot collide.
 */
export const FEED_SENT_KEY_PREFIX = "digest_sent:whatsapp_feed:";
export const FEED_FALLBACK_PINGED_PREFIX = "digest_fallback_pinged:";
export const FEED_ENABLED_KEY = "whatsapp_feed_enabled";

export const feedSentKey = (windowKey: string) => `${FEED_SENT_KEY_PREFIX}${windowKey}`;
export const feedFallbackPingedKey = (windowKey: string) => `${FEED_FALLBACK_PINGED_PREFIX}${windowKey}`;

/** Master switch. A missing row means ON, so a fresh deploy works out of the box. */
export async function isFeedEnabled(): Promise<boolean> {
  return (await getAppSetting(db, FEED_ENABLED_KEY)) !== "0";
}

/**
 * §5.6 — write the master switch, from the Settings card's toggle.
 *
 * Stored as `'1'`/`'0'` rather than "true"/"false" so it matches
 * `whatsapp_digest_enabled` and `exclude_bills`; the reader above only treats
 * `'0'` as off, which is what makes the missing-row-means-on rule work.
 */
export async function setFeedEnabled(enabled: boolean): Promise<void> {
  await setAppSetting(db, FEED_ENABLED_KEY, enabled ? "1" : "0");
}

/** The confirmed-send marker, also the `alreadySent` gate and the card's history record. */
export async function getFeedSentAt(windowKey: string): Promise<string | null> {
  return getAppSetting(db, feedSentKey(windowKey));
}

export async function recordFeedSent(windowKey: string): Promise<string> {
  const sentAt = new Date().toISOString();
  await setAppSetting(db, feedSentKey(windowKey), sentAt);
  return sentAt;
}

/* ----------------------------------------------------------------- feed ---- */

const UPDATE_ACTION = "update_transaction";
const DELETE_ACTIONS = ["delete_transaction", "delete_transactions"] as const;

interface UpdateTransactionPayload {
  before?: Record<string, TransactionSnapshot | null>;
  after?: Record<string, TransactionSnapshot>;
  changed?: Record<string, string[]>;
  via?: string;
  count?: number;
}

interface DeletePayload {
  transactions?: Array<Record<string, unknown>>;
}

interface RestorePayload {
  from?: string;
  restored?: number;
  /** Added with this feature — legacy entries carry only `from` + `restored`. */
  ids?: string[];
}

interface MergePayload {
  sourceName?: string;
  targetName?: string;
  moved?: { transactions?: number };
}

/** A stored payload is untrusted JSON — never assume its shape. */
function asSnapshot(value: unknown): TransactionSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.memberId !== "string" ||
    typeof row.amount !== "string" ||
    typeof row.date !== "string" ||
    typeof row.time !== "string"
  ) {
    return null;
  }
  const tag = (TRANSACTION_TAGS as readonly string[]).includes(row.tag as string)
    ? (row.tag as TransactionTag)
    : "one_time";
  return {
    memberId: row.memberId,
    categoryId: typeof row.categoryId === "string" ? row.categoryId : null,
    tag,
    amount: row.amount,
    note: typeof row.note === "string" ? row.note : null,
    date: row.date,
    time: row.time,
    splitWith: Array.isArray(row.splitWith)
      ? row.splitWith.filter((id): id is string => typeof id === "string")
      : [],
  };
}

export async function getLedgerFeed(window: FeedWindow): Promise<LedgerFeed> {
  const start = new Date(window.startIso);
  const end = new Date(window.endIso);
  const createdInWindow = and(gte(transactions.createdAt, start), lt(transactions.createdAt, end));
  const loggedInWindow = and(gte(activityLog.createdAt, start), lt(activityLog.createdAt, end));

  const [addedRows, totalRows, activityRows, memberRows, categoryRows] = await Promise.all([
    db
      .select({
        id: transactions.id,
        time: transactions.time,
        date: transactions.date,
        amount: transactions.amount,
        note: transactions.note,
        categoryId: transactions.categoryId,
        categoryName: categories.name,
        categoryEmoji: categories.emoji,
      })
      .from(transactions)
      // LEFT JOIN, mandatory: `category_id` is nullable by design (Amendment
      // 20) and NULL is the Uncategorized *state*, not a missing join.
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(createdInWindow)
      .orderBy(asc(transactions.createdAt)),
    // §7.2 — the closing total is a SQL SUM, never a JS reduce over the fetched rows.
    db
      .select({ total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)` })
      .from(transactions)
      .where(createdInWindow),
    db
      .select({
        id: activityLog.id,
        action: activityLog.action,
        payload: activityLog.payload,
        createdAt: activityLog.createdAt,
      })
      .from(activityLog)
      .where(
        and(
          loggedInWindow,
          inArray(activityLog.action, [UPDATE_ACTION, ...DELETE_ACTIONS, "restore_transactions", "merge_categories"]),
        ),
      )
      .orderBy(asc(activityLog.createdAt)),
    db.select({ id: members.id, name: members.name }).from(members),
    db.select({ id: categories.id, name: categories.name, emoji: categories.emoji }).from(categories),
  ]);

  const categoryById = new Map(categoryRows.map((row) => [row.id, row]));
  const memberById = new Map(memberRows.map((row) => [row.id, row]));

  /** Names are mutable labels resolved at read time; an unknown id falls back to the id itself. */
  const resolveCategory = (id: string): FeedCategoryRef => {
    const row = categoryById.get(id);
    return row ? { emoji: row.emoji, name: row.name } : { emoji: "❔", name: id };
  };
  const categoryRef = (id: string | null): FeedCategoryRef | null => (id ? resolveCategory(id) : null);
  const resolveMember = (id: string): string | null => memberById.get(id)?.name ?? null;

  const added: FeedAddedRow[] = addedRows.map((row) => ({
    id: row.id,
    time: row.time,
    date: row.date,
    amountPaise: rupeesToPaise(row.amount),
    note: row.note,
    category:
      row.categoryName && row.categoryEmoji
        ? { emoji: row.categoryEmoji, name: row.categoryName }
        : categoryRef(row.categoryId),
  }));

  const allDeleted: FeedDeletedRow[] = [];
  const restoredIds = new Set<string>();
  const legacyRestoreSources: string[] = [];
  const edited: FeedEditedRow[] = [];
  const merges: FeedMergeSummary[] = [];

  for (const entry of activityRows) {
    const payload = (entry.payload ?? {}) as Record<string, unknown>;

    if (entry.action === UPDATE_ACTION) {
      const update = payload as UpdateTransactionPayload;
      const changed = update.changed ?? {};
      const after = update.after ?? {};
      const before = update.before ?? {};
      for (const [transactionId, fields] of Object.entries(changed)) {
        if (!Array.isArray(fields) || fields.length === 0) continue; // defensive: no-op edits are never logged
        const afterSnapshot = asSnapshot(after[transactionId]);
        if (!afterSnapshot) continue;
        const changes = buildFeedChanges(
          asSnapshot(before[transactionId] ?? null),
          afterSnapshot,
          resolveMember,
          resolveCategory,
        );
        if (changes.length === 0) continue;
        edited.push({ id: entry.id, category: categoryRef(afterSnapshot.categoryId), changes });
      }
      continue;
    }

    if (entry.action === "merge_categories") {
      const merge = payload as MergePayload;
      merges.push({
        id: entry.id,
        sourceName: merge.sourceName ?? "category",
        targetName: merge.targetName ?? "category",
        moved: merge.moved?.transactions ?? 0,
      });
      continue;
    }

    if (entry.action === "restore_transactions") {
      const restore = payload as RestorePayload;
      if (Array.isArray(restore.ids)) {
        for (const id of restore.ids) if (typeof id === "string") restoredIds.add(id);
      } else if (typeof restore.from === "string") {
        // Legacy entry written before `ids` existed — resolve the originating
        // delete entry after the loop (it may sit OUTSIDE this window).
        legacyRestoreSources.push(restore.from);
      }
      continue;
    }

    // delete_transaction / delete_transactions — the snapshot carries the
    // whole row, which is why D5 needs no extra logging.
    const snapshots = (payload as DeletePayload).transactions;
    if (!Array.isArray(snapshots)) continue;
    for (const raw of snapshots) {
      const snapshot = asSnapshot(raw);
      const id = raw && typeof raw.id === "string" ? raw.id : null;
      if (!snapshot || !id) continue;
      allDeleted.push({
        id,
        amountPaise: rupeesToPaise(snapshot.amount),
        note: snapshot.note,
        category: categoryRef(snapshot.categoryId),
      });
    }
  }

  if (legacyRestoreSources.length > 0) {
    const legacyRows = await db
      .select({ payload: activityLog.payload })
      .from(activityLog)
      .where(inArray(activityLog.id, legacyRestoreSources));
    for (const row of legacyRows) {
      const snapshots = ((row.payload ?? {}) as DeletePayload).transactions;
      if (!Array.isArray(snapshots)) continue;
      for (const raw of snapshots) {
        if (raw && typeof raw.id === "string") restoredIds.add(raw.id);
      }
    }
  }

  // D6 — a delete and its Undo inside one window net out: neither the deletion
  // nor a synthetic re-add is reported. A restored row appears under Added only
  // if its own created_at falls in this window, which is legitimate.
  const deleted = allDeleted.filter((row) => !restoredIds.has(row.id));

  const counts = {
    added: added.length,
    edited: edited.length,
    deleted: deleted.length,
    merges: merges.length,
  };
  const addedTotalPaise = rupeesToPaise(totalRows[0]?.total ?? "0");

  return {
    window,
    added,
    edited,
    deleted,
    merges,
    counts,
    addedTotalPaise,
    empty: counts.added === 0 && counts.edited === 0 && counts.deleted === 0 && counts.merges === 0,
  };
}
