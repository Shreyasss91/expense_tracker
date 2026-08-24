// §6.6 Canonical CSV export format — shared by the export Server Action and
// the seed round-trip test, so the tested format is exactly the shipped format.
import { csvRow } from "./csv";

export const CSV_HEADER = "date,time,member,item,amount,category,tag";

export interface CsvExportRow {
  date: string;
  /** Stored TIME (HH:MM:SS); truncated to HH:MM in the output (§5.6). */
  time: string;
  /** Member's current display name (§6.6). */
  member: string;
  /** The transaction's note — the CSV's `item` column (§6.6). */
  note: string | null;
  /** NUMERIC string as returned by the driver; normalized to plain 2 dp. */
  amount: string;
  /** Category's current display name (§6.6); empty cell when uncategorized (Amendment 20). */
  category: string | null;
  tag: "one_time" | "recurring" | "lifestyle";
}

/** One CSV row per §6.6: same 7 columns as seed.csv, RFC 4180 quoted. */
export function formatCsvLine(r: CsvExportRow): string {
  return csvRow([
    r.date,
    r.time.slice(0, 5), // §5.6 HH:MM display form
    r.member,
    r.note ?? "",
    Number(r.amount).toFixed(2), // plain 2-dp decimal, no ₹, no grouping (§6.6)
    r.category ?? "",
    r.tag,
  ]);
}
