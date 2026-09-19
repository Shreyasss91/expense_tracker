import { format, parse } from "date-fns";
import { TRANSACTION_TAG_LABELS } from "./constants";
import { displayTime } from "./dates";
import { FEED_KEY_RE, type FeedWindow } from "./ledger-feed-window";
import { formatINR, rupeesToPaise } from "./money";
import { diffSnapshots, type TrackedField, type TransactionSnapshot } from "./transaction-diff";

/**
 * The ledger-change feed's **pure** rendering layer — types, sanitisation and
 * the message builder. No DB access and no `server-only` import, so it is
 * unit-testable (src/lib/ledger-feed-test.ts).
 *
 * Exactly the split digest.ts/digest-format.ts already uses: the DB-backed
 * query lives in ledger-feed.ts, which re-exports everything here so callers
 * keep one import.
 */

export interface FeedCategoryRef {
  emoji: string;
  name: string;
}

export interface FeedAddedRow {
  id: string;
  /** The transaction's own business time, HH:MM:SS. */
  time: string;
  /** The transaction's own business date, YYYY-MM-DD — may predate the window (D2). */
  date: string;
  amountPaise: number;
  note: string | null;
  category: FeedCategoryRef | null;
}

/**
 * One rendered change, with both sides pre-resolved. Keeping the union typed
 * (rather than pre-rendered strings) is what lets the builder's tests cover
 * every field's rendering without a database.
 */
export type FeedChange =
  | { field: "amount"; beforePaise: number; afterPaise: number }
  | { field: "note"; before: string | null; after: string | null }
  | { field: "categoryId"; before: FeedCategoryRef | null; after: FeedCategoryRef | null }
  | { field: "tag"; before: TransactionSnapshot["tag"]; after: TransactionSnapshot["tag"] }
  | { field: "dateTime"; beforeDate: string; beforeTime: string; afterDate: string; afterTime: string }
  | { field: "memberId"; before: string; after: string }
  | { field: "splitWith"; before: string[]; after: string[] };

export interface FeedEditedRow {
  /** The activity_log entry id. */
  id: string;
  /** Category **after** the change — what the expense is now. */
  category: FeedCategoryRef | null;
  changes: FeedChange[];
}

export interface FeedDeletedRow {
  id: string;
  amountPaise: number;
  note: string | null;
  category: FeedCategoryRef | null;
}

export interface FeedMergeSummary {
  id: string;
  sourceName: string;
  targetName: string;
  /** Transactions re-pointed by the merge. */
  moved: number;
}

export interface LedgerFeed {
  window: FeedWindow;
  added: FeedAddedRow[];
  edited: FeedEditedRow[];
  deleted: FeedDeletedRow[];
  merges: FeedMergeSummary[];
  /** Post-netting counts (D6) — the same numbers the section headers print. */
  counts: { added: number; edited: number; deleted: number; merges: number };
  /** Integer paise — the sum of `added` only. Labelled "Entered in this window". */
  addedTotalPaise: number;
  /** True when there is nothing to say (all four counts are zero). */
  empty: boolean;
}

/** Rendered when a transaction has no category (a state, never a category row). */
export const UNCATEGORIZED_LABEL = "❔ Uncategorized";

/** Notes are free user text; 80 chars keeps a chat message readable. */
export const NOTE_MAX_CHARS = 80;

/** Per-section row cap — a bulk import must not produce a wall of text. */
export const MAX_SECTION_ROWS = 40;

/** Assembly guard: past this the Added section is truncated further. */
export const MAX_MESSAGE_CHARS = 50_000;

/** Cap on the agent-reported failure `detail` that reaches a log line. */
export const LOG_DETAIL_MAX_CHARS = 300;

/**
 * Log hygiene for the agent's failure `detail` — a string that arrives over HTTP
 * from outside the app, and is written into a log line.
 *
 * Two hazards, one function. **Unbounded:** a caller could put a megabyte into
 * every line of the server log. **Newlines:** without stripping, a caller can
 * forge additional log lines, which is what makes a log untrustworthy exactly
 * when someone is reading it during an incident.
 *
 * Every C0/C1 control character is collapsed to a space — not just `\n` and
 * `\r`, because a lone `\t` or a vertical tab is just as effective at breaking a
 * line's shape. The truncation marker is appended **outside** the cap on
 * purpose: silently clipping would hide that anything was dropped, and knowing a
 * detail was cut is often the whole diagnosis.
 */
export function sanitizeLogDetail(value: unknown): string {
  if (typeof value !== "string") return "";
  const flattened = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (flattened.length <= LOG_DETAIL_MAX_CHARS) return flattened;
  // Drop a trailing lone high surrogate: cutting between the two halves of a
  // surrogate pair would otherwise leave a broken character in the log.
  const clipped = flattened.slice(0, LOG_DETAIL_MAX_CHARS).replace(/[\uD800-\uDBFF]$/, "");
  return `${clipped}… (truncated, ${flattened.length} chars)`;
}

/**
 * Prefixes for the change fields that would otherwise be ambiguous when two
 * changes are joined by " · ". `amount`, `categoryId` and `tag` deliberately
 * carry none, which is what makes the compact `🍔 Dining Out · ₹450 → ₹500`
 * line in the spec's sample.
 */
const CHANGE_PREFIX: Record<"note" | "dateTime" | "memberId" | "splitWith", string> = {
  note: "note",
  dateTime: "when",
  memberId: "for",
  splitWith: "assigned",
};

/**
 * WhatsApp interprets `*`, `_`, `~` and `` ` `` as markup, so a stray asterisk
 * in a note would bold the remainder of the message.
 *
 * The substitution is **unconditional** — no "only escape an unpaired `_`"
 * cleverness. WhatsApp's parser rules are undocumented and change; a fixed map
 * is the only predictable behaviour, and the replacements render essentially
 * identically. Every user-originated string goes through here (notes, category
 * names).
 */
export function sanitizeWhatsAppText(value: string): string {
  return (
    value
      .replace(/\*/g, "∗") // U+2217 ASTERISK OPERATOR
      .replace(/_/g, "‐") // U+2010 HYPHEN
      .replace(/~/g, "∼") // U+223C TILDE OPERATOR
      .replace(/`/g, "'")
      // Control characters, including the newlines/tabs that a pasted note can carry.
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Note for the message: sanitised, then truncated with an ellipsis. */
function renderNote(note: string | null): string | null {
  if (!note) return null;
  const clean = sanitizeWhatsAppText(note);
  if (!clean) return null;
  return clean.length > NOTE_MAX_CHARS ? `${clean.slice(0, NOTE_MAX_CHARS - 1)}…` : clean;
}

/** `⛽ Fuel`, or the fixed Uncategorized label. Category names are sanitised too — a rename can add an asterisk. */
export function categoryLabel(category: FeedCategoryRef | null): string {
  if (!category) return UNCATEGORIZED_LABEL;
  return `${category.emoji} ${sanitizeWhatsAppText(category.name)}`;
}

/**
 * A row's time, e.g. "09:14". Dates are printed **only** when the expense's own
 * business date differs from the window's end date (D2: a transaction entered
 * tonight may have happened days ago) — so today's rows carry no redundant date.
 */
function rowTimeLabel(date: string, time: string, windowEndDate: string): string {
  if (date === windowEndDate) return displayTime(time);
  return `${format(parse(date, "yyyy-MM-dd", new Date()), "d MMM")} ${displayTime(time)}`;
}

function memberListLabel(ids: string[]): string {
  return ids.length === 0 ? "Nobody" : ids.join(", ");
}

function renderCategoryPair(before: FeedCategoryRef | null, after: FeedCategoryRef | null): string {
  return `${categoryLabel(before)} → ${categoryLabel(after)}`;
}

/** `<emoji> <name> · ₹450 → ₹500`, with the delimiters the format spec fixes. */
function renderChange(change: FeedChange): string {
  const prefix = (field: keyof typeof CHANGE_PREFIX) => `${CHANGE_PREFIX[field]}: `;
  switch (change.field) {
    case "amount":
      return `${formatINR(change.beforePaise)} → ${formatINR(change.afterPaise)}`;
    case "note":
      return `${prefix("note")}"${renderNote(change.before) ?? ""}" → "${renderNote(change.after) ?? ""}"`;
    case "categoryId":
      return renderCategoryPair(change.before, change.after);
    case "tag":
      return `${TRANSACTION_TAG_LABELS[change.before]} → ${TRANSACTION_TAG_LABELS[change.after]}`;
    case "dateTime":
      return `${prefix("dateTime")}${rowTimeLabel(change.beforeDate, change.beforeTime, change.afterDate)} → ${rowTimeLabel(change.afterDate, change.afterTime, change.afterDate)}`;
    case "memberId":
      return `${prefix("memberId")}${change.before} → ${change.after}`;
    case "splitWith":
      return `${prefix("splitWith")}${memberListLabel(change.before)} → ${memberListLabel(change.after)}`;
  }
}

/**
 * Turn a diffed snapshot pair into renderable changes.
 *
 * `date` and `time` collapse into ONE combined change when either moves, per
 * the format spec. The resolvers come from the caller because names are
 * mutable display labels resolved at read time (SPEC §3.2.2, §5.3) — an
 * unresolved id falls back to the raw id rather than throwing.
 */
export function buildFeedChanges(
  before: TransactionSnapshot | null,
  after: TransactionSnapshot,
  resolveMember: (id: string) => string | null,
  resolveCategory: (id: string) => FeedCategoryRef | null,
): FeedChange[] {
  const changed: TrackedField[] = diffSnapshots(before, after);
  if (!before || changed.length === 0) return [];

  const changes: FeedChange[] = [];
  const member = (id: string) => resolveMember(id) ?? id;

  for (const field of changed) {
    switch (field) {
      case "date":
      case "time":
        if (!changes.some((c) => c.field === "dateTime")) {
          changes.push({
            field: "dateTime",
            beforeDate: before.date,
            beforeTime: before.time,
            afterDate: after.date,
            afterTime: after.time,
          });
        }
        break;
      case "amount":
        changes.push({
          field: "amount",
          beforePaise: rupeesToPaise(before.amount),
          afterPaise: rupeesToPaise(after.amount),
        });
        break;
      case "note":
        changes.push({ field: "note", before: before.note, after: after.note });
        break;
      case "categoryId":
        changes.push({
          field: "categoryId",
          before: before.categoryId ? resolveCategory(before.categoryId) : null,
          after: after.categoryId ? resolveCategory(after.categoryId) : null,
        });
        break;
      case "tag":
        changes.push({ field: "tag", before: before.tag, after: after.tag });
        break;
      case "memberId":
        changes.push({ field: "memberId", before: member(before.memberId), after: member(after.memberId) });
        break;
      case "splitWith":
        changes.push({
          field: "splitWith",
          before: before.splitWith.map(member),
          after: after.splitWith.map(member),
        });
        break;
    }
  }
  return changes;
}

/**
 * One event in the ordered delete/restore walk that produces the Deleted
 * section. Built by ledger-feed.ts from `activity_log`, in `created_at` order.
 */
export type FeedNetEvent =
  | { kind: "delete"; row: FeedDeletedRow }
  | { kind: "restore"; ids: readonly string[] };

/**
 * D6 — collapse each deletion against the restore that Undid it, in time order.
 *
 * **Ordered, not set-based.** The obvious implementation collects every restored
 * id into a `Set` and drops every deletion carrying one — the shape the spec's
 * §5.4.4 step 2 describes. That is wrong for a re-delete: delete X, Undo X, then
 * delete X again, all inside one window, and the set drops *both* deletions, so
 * the family is told nothing even though X is deleted at close. Matching each
 * restore against the most recent **still-open** deletion for the same id is
 * what makes the outcome equal the net change. A restore therefore cancels one
 * deletion, never all of them.
 *
 * A restore whose id has no open deletion — the row was deleted in an *earlier*
 * window — cancels nothing (E5). It is genuinely this window's business only if
 * it re-adds the row, which it must not: a restore is not a change of its own,
 * and step 3 forbids synthesising an Added row. With `created_at` preserved on
 * restore, such a row stays out of `added` too.
 */
export function netDeletedRows(events: readonly FeedNetEvent[]): FeedDeletedRow[] {
  const deletions: FeedDeletedRow[] = [];
  const cancelled = new Set<FeedDeletedRow>();
  /** id → the deletions of it that no restore has claimed yet, oldest first. */
  const open = new Map<string, FeedDeletedRow[]>();

  for (const event of events) {
    if (event.kind === "delete") {
      deletions.push(event.row);
      const stack = open.get(event.row.id);
      if (stack) stack.push(event.row);
      else open.set(event.row.id, [event.row]);
      continue;
    }
    for (const id of event.ids) {
      const stack = open.get(id);
      if (!stack || stack.length === 0) continue;
      cancelled.add(stack.pop() as FeedDeletedRow);
    }
  }

  // Identity, not equality: two deletions can be structurally identical rows,
  // and only the exact instance a restore claimed may be dropped.
  return deletions.filter((row) => !cancelled.has(row));
}

function addedLine(row: FeedAddedRow, windowEndDate: string): string {
  const head = `${rowTimeLabel(row.date, row.time, windowEndDate)} · ${categoryLabel(row.category)} · ${formatINR(row.amountPaise)}`;
  const note = renderNote(row.note);
  return note ? `${head}\n   ${note}` : head;
}

function editedLine(row: FeedEditedRow): string {
  return `${categoryLabel(row.category)} · ${row.changes.map(renderChange).join(" · ")}`;
}

function deletedLine(row: FeedDeletedRow): string {
  const head = `${categoryLabel(row.category)} · ${formatINR(row.amountPaise)}`;
  const note = renderNote(row.note);
  return note ? `${head}\n   ${note}` : head;
}

function mergeLine(row: FeedMergeSummary): string {
  const moved = row.moved === 1 ? "1 entry moved" : `${row.moved} entries moved`;
  return `🔀 Merged "${sanitizeWhatsAppText(row.sourceName)}" into "${sanitizeWhatsAppText(row.targetName)}" · ${moved}`;
}

/** Section header + capped rows + the truncation line. Counts stay TRUE (pre-cap). */
function section(title: string, lines: string[], cap: number): string {
  const shown = lines.slice(0, cap);
  const hidden = lines.length - shown.length;
  const body = [...shown];
  if (hidden > 0) body.push(`… and ${hidden} more`);
  return `*${title} (${lines.length})*\n${body.join("\n")}`;
}

/**
 * §5.4.6 — the delivered message, or `null` when there is nothing to say (D7).
 *
 * Assembly order is fixed: header, Added, Edited, Deleted, merges, total. A
 * section with no entries is omitted entirely (never rendered empty), and the
 * total is additions-only — the label says "Entered", so it must mean entered.
 */
export function buildLedgerFeedMessage(feed: LedgerFeed): string | null {
  if (feed.empty) return null;

  const build = (addedCap: number): string => {
    const blocks: string[] = [
      `*Family Ledger — daily changes*\n_${feed.window.label}_`,
    ];

    if (feed.added.length > 0) blocks.push(section("Added", feed.added.map((row) => addedLine(row, feed.window.endDateIst)), addedCap));
    if (feed.edited.length > 0) blocks.push(section("Edited", feed.edited.map(editedLine), MAX_SECTION_ROWS));
    if (feed.deleted.length > 0) blocks.push(section("Deleted", feed.deleted.map(deletedLine), MAX_SECTION_ROWS));
    if (feed.merges.length > 0) blocks.push(feed.merges.map(mergeLine).join("\n"));

    // Additions only: edits and deletions are not "entered". With no additions
    // the line is omitted — a ₹0 total would be misleading.
    if (feed.added.length > 0) {
      blocks.push(`*Entered in this window: ${formatINR(feed.addedTotalPaise)}*`);
    }
    return blocks.join("\n\n");
  };

  let message = build(MAX_SECTION_ROWS);
  // Pathological day (bulk import + long notes): shrink the Added section until
  // it fits. Edits/deletions are structurally small, so Added carries the bulk.
  let cap = MAX_SECTION_ROWS;
  while (message.length > MAX_MESSAGE_CHARS && cap > 1) {
    cap = Math.floor(cap / 2);
    message = build(cap);
  }
  return message.length > MAX_MESSAGE_CHARS ? `${message.slice(0, MAX_MESSAGE_CHARS - 1)}…` : message;
}

/** Cheap guard for callers holding an unvalidated key (the POST endpoint). */
export function isFeedKey(value: string): boolean {
  return FEED_KEY_RE.test(value);
}
