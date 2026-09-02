/**
 * §2.10 — the export format layer: pure, DB-free, unit-testable.
 *
 * Three output shapes share one row type:
 *
 *   CSV      7 columns  — the CANONICAL interchange format. Byte-identical to
 *                         seed.csv, which is what makes `db:seed` and
 *                         `verify:export-live` possible. Re-importable.
 *   CSV      16 columns — the EXTENDED format: adds ids, slugs, the group
 *                         roll-up, shared/split_with, reviewed_at, created_at
 *                         and an attachment count. Everything except the
 *                         attachment *bytes* (those live in object storage;
 *                         the locator is listed so a restore can re-fetch).
 *   JSON     full       — every column above, losslessly typed (amount as both
 *                         a rupee decimal and integer paise, timestamps as ISO,
 *                         attachments as an array of objects). This is the
 *                         backup format; it is what the import path prefers.
 *   XLSX     full-ish   — the extended column set, numbers as numbers, for
 *                         people who want to pivot in a spreadsheet.
 *
 * Nothing here touches the database or React — see export-rows.ts for the
 * query side and /api/export for the streaming route.
 */
import { CSV_HEADER, formatCsvLine } from "./csv-export";
import { csvRow } from "./csv";
import type { XlsxCell } from "./xlsx";

export type ExportFormat = "csv" | "json" | "xlsx";

export const EXPORT_FORMATS: readonly ExportFormat[] = ["csv", "json", "xlsx"];

export const EXPORT_MIME: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/**
 * §1.10 — the export used to materialise every matching row plus one giant
 * string in memory, with no ceiling. A household ledger grows forever, so
 * this is the hard ceiling on a single export: the query stops after this many
 * rows and the response says so, rather than OOM-ing the serverless function.
 * Raise it (or drop it) only together with the runtime memory limit.
 */
export const EXPORT_ROW_CAP = 100_000;

/** Rows fetched per round-trip while streaming. Small enough to bound memory. */
export const EXPORT_BATCH_SIZE = 500;

/** Largest import file accepted (UTF-8 text). ~50k rows of CSV. */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

export type CsvFlavour = "canonical" | "extended";

export interface ExportAttachment {
  /** Object-storage locator, e.g. "receipts/2026/09/<uuid>.jpg". */
  pathname: string;
  contentType: string;
  sizeBytes: number;
}

/** One exported transaction — the union of every export format's needs. */
export interface ExportRow {
  id: string;
  /** YYYY-MM-DD (IST calendar date, §5.7). */
  date: string;
  /** Stored TIME (HH:MM:SS); CSV renders the §5.6 HH:MM display form. */
  time: string;
  member: string;
  memberSlug: string;
  note: string | null;
  /** NUMERIC(12,2) as returned by the driver, e.g. "1234.00". */
  amount: string;
  /** Leaf category display name; null = uncategorized (Amendment 20). */
  category: string | null;
  categorySlug: string | null;
  /** Parent (group) display name; null for uncategorized rows. */
  group: string | null;
  tag: "one_time" | "recurring" | "lifestyle";
  /** §2.2 — household-shared expense rather than one member's. */
  shared: boolean;
  /** §2.2 — member SLUGS to split among; empty = everyone. */
  splitWith: string[];
  /** ISO timestamp; null = still pending review (§6.4). */
  reviewedAt: string | null;
  /** ISO timestamp of row creation. */
  createdAt: string;
  attachments: ExportAttachment[];
}

/** The 7-column seed.csv contract — preserved verbatim (§8). */
export const CANONICAL_CSV_HEADER = CSV_HEADER;

export const EXTENDED_CSV_HEADER = [
  "id",
  "date",
  "time",
  "member",
  "member_slug",
  "item",
  "amount",
  "category",
  "category_slug",
  "group",
  "tag",
  "shared",
  "split_with",
  "reviewed_at",
  "created_at",
  "attachments",
].join(",");

export const XLSX_HEADERS: string[] = [
  "Date",
  "Time",
  "Member",
  "Item",
  "Amount",
  "Category",
  "Group",
  "Tag",
  "Shared",
  "Split with",
  "Reviewed at",
  "Created at",
  "Receipts",
];

/** The canonical 7-column line — byte-identical to seed.csv's rows. */
export function canonicalCsvLine(row: ExportRow): string {
  return formatCsvLine({
    date: row.date,
    time: row.time,
    member: row.member,
    note: row.note,
    amount: row.amount,
    category: row.category,
    tag: row.tag,
  });
}

/** RFC 4180: join on ";" so a value containing a comma stays unambiguous. */
function joinList(values: string[]): string {
  return values.join(";");
}

/** The extended 16-column line. Times stay HH:MM; timestamps are ISO-8601. */
export function extendedCsvLine(row: ExportRow): string {
  return csvRow([
    row.id,
    row.date,
    row.time.slice(0, 5),
    row.member,
    row.memberSlug,
    row.note ?? "",
    Number(row.amount).toFixed(2),
    row.category ?? "",
    row.categorySlug ?? "",
    row.group ?? "",
    row.tag,
    row.shared ? "1" : "0",
    joinList(row.splitWith),
    row.reviewedAt ?? "",
    row.createdAt,
    joinList(row.attachments.map((a) => a.pathname)),
  ]);
}

export function csvLine(row: ExportRow, flavour: CsvFlavour): string {
  return flavour === "canonical" ? canonicalCsvLine(row) : extendedCsvLine(row);
}

export function csvHeader(flavour: CsvFlavour): string {
  return flavour === "canonical" ? CANONICAL_CSV_HEADER : EXTENDED_CSV_HEADER;
}

/** Full-fidelity JSON record. Amounts carry both forms; paise is authoritative. */
export function exportRowToJson(row: ExportRow) {
  return {
    id: row.id,
    date: row.date,
    time: row.time.slice(0, 5),
    member: row.member,
    member_slug: row.memberSlug,
    note: row.note,
    amount: Number(row.amount).toFixed(2),
    amount_paise: Math.round(Number(row.amount) * 100),
    category: row.category,
    category_slug: row.categorySlug,
    group: row.group,
    tag: row.tag,
    shared: row.shared,
    split_with: row.splitWith,
    reviewed_at: row.reviewedAt,
    created_at: row.createdAt,
    attachments: row.attachments.map((a) => ({
      pathname: a.pathname,
      content_type: a.contentType,
      size_bytes: a.sizeBytes,
    })),
  };
}

export type ExportJsonRecord = ReturnType<typeof exportRowToJson>;

/**
 * Spreadsheet row. The amount is emitted as a NUMBER (not a formatted ₹
 * string) so the sheet can sum, sort and chart it; every other column is
 * text. Receipts become a count plus a newline-joined locator list.
 */
export function exportRowToXlsx(row: ExportRow): XlsxCell[] {
  return [
    row.date,
    row.time.slice(0, 5),
    row.member,
    row.note ?? "",
    Number(row.amount),
    row.category ?? "Uncategorized",
    row.group ?? "",
    row.tag,
    row.shared ? "yes" : "no",
    joinList(row.splitWith),
    row.reviewedAt ?? "",
    row.createdAt,
    row.attachments.length,
  ];
}

export const EXPORT_SCHEMA_VERSION = "family-ledger-export@1";

/**
 * Filename scope vocabulary — shared with the pre-§2.10 `exportCsv` so old and
 * new filenames read identically and sort together.
 */
export function exportScopeParts(filters: {
  month?: string;
  memberId?: string;
  tag?: string;
  uncategorized?: boolean;
  categoryId?: string;
  groupId?: string;
  from?: string;
  to?: string;
}): string[] {
  const parts: string[] = [filters.month ?? "all"];
  if (filters.memberId) parts.push("member");
  if (filters.tag) parts.push(filters.tag);
  if (filters.uncategorized) parts.push("uncategorized");
  if (filters.categoryId) parts.push("category");
  if (filters.groupId) parts.push("group");
  if (filters.from || filters.to) parts.push("range");
  return parts;
}

/**
 * Filename that describes the export at a glance:
 * `ledger-2026-08-member-lifestyle-2026-09-01.csv`. Same scope vocabulary as
 * the pre-§2.10 `exportCsv`, so old and new filenames sort together.
 */
export function buildExportFilename(
  parts: string[],
  format: ExportFormat,
  today: string,
  flavour: CsvFlavour = "extended",
): string {
  const scope = parts.length > 0 ? parts.join("-") : "all";
  const suffix = format === "csv" && flavour === "canonical" ? "canonical.csv" : format;
  return `ledger-${scope}-${today}.${suffix}`;
}

/** URL of the streaming export route for the ledger's current filter set. */
export function buildExportUrl(
  format: ExportFormat,
  params: URLSearchParams | Record<string, string | undefined>,
  flavour: CsvFlavour = "extended",
): string {
  const search = new URLSearchParams(params as Record<string, string>);
  search.set("format", format);
  if (format === "csv") search.set("columns", flavour);
  return `/api/export?${search.toString()}`;
}

/**
 * §2.10 — the monthly backup artefact name. Deliberately month-scoped and
 * sortable so an inbox full of them reads chronologically.
 */
export function backupFilename(month: string, format: ExportFormat): string {
  return `ledger-backup-${month}.${format === "csv" ? "canonical.csv" : format}`;
}
