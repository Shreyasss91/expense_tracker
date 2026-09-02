/**
 * §2.10 — the import half of "export and backup". Pure: no DB, no React.
 *
 * Export used to be one-way — the CSV was a dead end you could read but never
 * feed back in, so a restore meant hand-re-keying the ledger. This module is
 * the parse/validate half of the round trip; the id resolution and the insert
 * live in src/actions/import.ts.
 *
 * Two shapes are accepted, and they are detected rather than asked for:
 *
 *   canonical CSV  the 7-column seed.csv contract — what `db:seed` reads and
 *                  what `verify:export-live` diffs against. Round-trips.
 *   extended CSV   the 16-column export — carries ids, slugs, reviewed_at,
 *                  shared/split_with and attachment locators.
 *   JSON           the full-fidelity backup. Preferred: it is the only shape
 *                  that preserves ids, so it is the only one that restores
 *                  rather than re-creates.
 *
 * Design rule: a bad row is never fatal to the file. Every row carries its own
 * `issues[]`; the caller decides whether to import the clean rows and report
 * the rest. A half-good backup is still worth restoring.
 */
import { parseCsv } from "./csv";
import { TRANSACTION_TAGS } from "./constants";
import { EXTENDED_CSV_HEADER, IMPORT_MAX_BYTES, type ExportJsonRecord } from "./export-format";
import type { ImportSource } from "./import-types";

export type { ImportSource };

export interface ImportDraftRow {
  /** 1-based line/record number in the source file, for the error report. */
  rowNumber: number;
  /** Present only for JSON/extended-CSV restores — absent means "new row". */
  id?: string;
  date: string;
  /** Normalised to HH:MM (§5.6 display form; :00 seconds re-added on write). */
  time: string;
  member?: string;
  memberSlug?: string;
  note: string | null;
  /** Canonical 2-dp rupee string, ready for NUMERIC(12,2). */
  amount: string;
  category: string | null;
  categorySlug: string | null;
  tag: (typeof TRANSACTION_TAGS)[number];
  shared: boolean;
  splitWith: string[];
  /** ISO timestamp, or null when the original row was still pending review. */
  reviewedAt: string | null;
  /** Object-storage locators of any receipts (restored as metadata only). */
  attachments: string[];
  /** Non-fatal per-row notes; fatal problems are listed here too and skipped. */
  issues: string[];
}

export interface ImportParseResult {
  source: ImportSource;
  rows: ImportDraftRow[];
  /** Set when the file as a whole is unusable (bad JSON, malformed CSV). */
  fatal?: string;
  blankRows: number;
}

const CANONICAL_FIELDS = 7;

function isBlankRow(fields: string[]): boolean {
  return fields.every((f) => f.trim() === "");
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** Accept HH:MM or HH:MM:SS; normalise to HH:MM. */
function normaliseTime(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Accept "1234", "1234.5", "1234.56". Rejects negatives, currency, grouping. */
function normaliseAmount(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const asNumber = Number(trimmed);
  if (!Number.isFinite(asNumber) || asNumber < 0) return null;
  return asNumber.toFixed(2);
}

function normaliseTag(value: string): (typeof TRANSACTION_TAGS)[number] | null {
  const trimmed = value.trim();
  return (TRANSACTION_TAGS as readonly string[]).includes(trimmed)
    ? (trimmed as (typeof TRANSACTION_TAGS)[number])
    : null;
}

/** split_with is a ";"-joined list in CSV and an array in JSON. */
function splitList(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  return value
    .split(";")
    .map((v) => v.trim())
    .filter(Boolean);
}

function truthy(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const s = String(value ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const asDate = new Date(String(value));
  return Number.isNaN(asDate.getTime()) ? null : asDate.toISOString();
}

/* ------------------------------------------------------------------ CSV ---- */

function parseCanonicalCsv(table: string[][]): { rows: ImportDraftRow[]; blankRows: number } {
  const rows: ImportDraftRow[] = [];
  let blankRows = 0;

  table.forEach((fields, index) => {
    const rowNumber = index + 2; // +1 for the header, +1 for 1-based lines
    if (isBlankRow(fields)) {
      blankRows += 1;
      return;
    }
    const issues: string[] = [];
    if (fields.length !== CANONICAL_FIELDS) {
      issues.push(`expected ${CANONICAL_FIELDS} columns, found ${fields.length}`);
    }
    const [date, rawTime, member, item, rawAmount, category, rawTag] = fields;

    const time = rawTime ? normaliseTime(rawTime) : "00:00";
    if (rawTime && time === null) issues.push(`unreadable time "${rawTime}"`);
    const amount = normaliseAmount(rawAmount ?? "");
    if (amount === null) issues.push(`unreadable amount "${rawAmount ?? ""}"`);
    const tag = normaliseTag(rawTag ?? "");
    if (tag === null) issues.push(`unknown tag "${rawTag ?? ""}"`);
    if (!isRealDate(date ?? "")) issues.push(`unreadable date "${date ?? ""}"`);
    if (!member?.trim()) issues.push("missing member");

    rows.push({
      rowNumber,
      date: date ?? "",
      time: time ?? "00:00",
      member: member?.trim() || undefined,
      note: item?.trim() ? item.trim() : null,
      amount: amount ?? "0.00",
      // An empty category cell is the canonical way to say "uncategorized".
      category: category?.trim() ? category.trim() : null,
      categorySlug: null,
      tag: tag ?? "one_time",
      shared: false,
      splitWith: [],
      reviewedAt: null,
      attachments: [],
      issues,
    });
  });

  return { rows, blankRows };
}

const EXTENDED_COLUMNS = EXTENDED_CSV_HEADER.split(",");

function parseExtendedCsv(table: string[][]): { rows: ImportDraftRow[]; blankRows: number } {
  const rows: ImportDraftRow[] = [];
  let blankRows = 0;

  table.forEach((fields, index) => {
    const rowNumber = index + 2;
    if (isBlankRow(fields)) {
      blankRows += 1;
      return;
    }
    const issues: string[] = [];
    if (fields.length !== EXTENDED_COLUMNS.length) {
      issues.push(`expected ${EXTENDED_COLUMNS.length} columns, found ${fields.length}`);
    }
    const at = (name: string) => fields[EXTENDED_COLUMNS.indexOf(name)] ?? "";

    const date = at("date");
    const rawTime = at("time");
    const time = rawTime ? normaliseTime(rawTime) : "00:00";
    if (rawTime && time === null) issues.push(`unreadable time "${rawTime}"`);
    const amount = normaliseAmount(at("amount"));
    if (amount === null) issues.push(`unreadable amount "${at("amount")}"`);
    const tag = normaliseTag(at("tag"));
    if (tag === null) issues.push(`unknown tag "${at("tag")}"`);
    if (!isRealDate(date)) issues.push(`unreadable date "${date}"`);
    const member = at("member").trim() || at("member_slug").trim();
    if (!member) issues.push("missing member");

    const id = at("id").trim();
    rows.push({
      rowNumber,
      ...(id ? { id } : {}),
      date,
      time: time ?? "00:00",
      member: member || undefined,
      memberSlug: at("member_slug").trim() || undefined,
      note: at("item").trim() ? at("item").trim() : null,
      amount: amount ?? "0.00",
      category: at("category").trim() || null,
      categorySlug: at("category_slug").trim() || null,
      tag: tag ?? "one_time",
      shared: truthy(at("shared")),
      splitWith: splitList(at("split_with")),
      reviewedAt: isoOrNull(at("reviewed_at")),
      attachments: splitList(at("attachments")),
      issues,
    });
  });

  return { rows, blankRows };
}

/* ----------------------------------------------------------------- JSON ---- */

function recordFromJson(value: Record<string, unknown>, rowNumber: number): ImportDraftRow {
  const issues: string[] = [];
  const str = (key: string) => {
    const v = value[key];
    return v === null || v === undefined ? "" : String(v);
  };

  const date = str("date").trim();
  const rawTime = str("time").trim();
  const time = rawTime ? normaliseTime(rawTime) : "00:00";
  if (rawTime && time === null) issues.push(`unreadable time "${rawTime}"`);

  // Amount: prefer integer paise (lossless), fall back to the decimal string.
  let amount: string | null = null;
  const paise = value["amount_paise"];
  if (typeof paise === "number" && Number.isFinite(paise)) {
    amount = (paise / 100).toFixed(2);
  } else if (typeof paise === "string" && /^-?\d+$/.test(paise)) {
    amount = (Number(paise) / 100).toFixed(2);
  } else {
    amount = normaliseAmount(str("amount"));
  }
  if (amount === null) issues.push(`unreadable amount "${str("amount")}"`);

  const tag = normaliseTag(str("tag"));
  if (tag === null) issues.push(`unknown tag "${str("tag")}"`);
  if (!isRealDate(date)) issues.push(`unreadable date "${date}"`);

  const member = str("member").trim();
  const memberSlug = str("member_slug").trim();
  if (!member && !memberSlug) issues.push("missing member");

  const id = str("id").trim();
  const category = str("category").trim();
  const rawAttachments = value["attachments"];

  return {
    rowNumber,
    ...(id ? { id } : {}),
    date,
    time: time ?? "00:00",
    member: member || undefined,
    memberSlug: memberSlug || undefined,
    note: str("note").trim() ? str("note").trim() : null,
    amount: amount ?? "0.00",
    category: category || null,
    categorySlug: str("category_slug").trim() || null,
    tag: tag ?? "one_time",
    shared: truthy(value["shared"]),
    splitWith: splitList(value["split_with"] as string[] | string | null),
    reviewedAt: isoOrNull(value["reviewed_at"]),
    attachments: Array.isArray(rawAttachments)
      ? rawAttachments
          .map((a) => (a && typeof a === "object" ? String((a as { pathname?: unknown }).pathname ?? "") : String(a ?? "")))
          .map((p) => p.trim())
          .filter(Boolean)
      : [],
    issues,
  };
}

function parseJson(text: string): { rows: ImportDraftRow[]; blankRows: number } | { fatal: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { fatal: "not valid JSON" };
  }

  // Accept the exporter's envelope, a bare array, or a {rows:[...]} wrapper.
  let records: unknown[];
  if (Array.isArray(parsed)) records = parsed;
  else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { rows?: unknown }).rows)) {
    records = (parsed as { rows: unknown[] }).rows;
  } else {
    return { fatal: "JSON must be an array of transactions or an object with a `rows` array" };
  }

  const rows: ImportDraftRow[] = [];
  records.forEach((record, index) => {
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      rows.push({
        rowNumber: index + 1,
        date: "",
        time: "00:00",
        note: null,
        amount: "0.00",
        category: null,
        categorySlug: null,
        tag: "one_time",
        shared: false,
        splitWith: [],
        reviewedAt: null,
        attachments: [],
        issues: ["record is not a transaction object"],
      });
      return;
    }
    rows.push(recordFromJson(record as Record<string, unknown>, index + 1));
  });

  return { rows, blankRows: 0 };
}

/* ---------------------------------------------------------------- entry ---- */

/**
 * Parse an uploaded backup file into draft rows. Never throws for bad *rows* —
 * only the whole-file failures (unreadable JSON, unterminated quote, oversized
 * input) come back as `fatal`.
 */
export function parseImportFile(filename: string, text: string): ImportParseResult {
  if (text.length > IMPORT_MAX_BYTES) {
    return { source: "csv-canonical", rows: [], fatal: `file exceeds the ${Math.round(IMPORT_MAX_BYTES / 1024 / 1024)} MB import limit`, blankRows: 0 };
  }

  const isJson = /\.json$/i.test(filename) || text.trimStart().startsWith("{") || text.trimStart().startsWith("[");

  if (isJson) {
    const result = parseJson(text);
    if ("fatal" in result) return { source: "json", rows: [], fatal: result.fatal, blankRows: 0 };
    return { source: "json", rows: result.rows, blankRows: result.blankRows };
  }

  let table: string[][];
  try {
    table = parseCsv(text);
  } catch (error) {
    return { source: "csv-canonical", rows: [], fatal: (error as Error).message, blankRows: 0 };
  }

  if (table.length === 0) {
    return { source: "csv-canonical", rows: [], fatal: "file is empty", blankRows: 0 };
  }

  const header = table[0];
  const isExtended = header[0]?.trim().toLowerCase() === "id";
  const body = table.slice(1);
  const parsed = isExtended ? parseExtendedCsv(body) : parseCanonicalCsv(body);

  return {
    source: isExtended ? "csv-extended" : "csv-canonical",
    rows: parsed.rows,
    blankRows: parsed.blankRows,
  };
}

/** Rows with no blocking issue — these are what the importer will attempt. */
export function isImportable(row: ImportDraftRow): boolean {
  return row.issues.length === 0;
}

/**
 * §2.10 — the natural key used to recognise an already-present row.
 *
 * A CSV restore has no ids (they live only in the JSON/extended shapes), so
 * without this a second import of the same file would double every entry.
 * Date + time + member + amount + note is as close to an identity as the
 * canonical format allows, and it is exactly the tuple the exporter emits.
 */
export function importFingerprint(input: {
  date: string;
  time: string;
  memberId: string;
  amount: string;
  note: string | null;
}): string {
  return [input.date, input.time, input.memberId, Number(input.amount).toFixed(2), input.note ?? ""].join("");
}

/** Re-exported so the importer can type the JSON it accepts without importing server code. */
export type { ExportJsonRecord };
