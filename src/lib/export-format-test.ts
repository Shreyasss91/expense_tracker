/**
 * Export/import format test — `npm run test:export-format`.
 *
 * §2.10's headline claim is that export is no longer one-way. This test is the
 * evidence, exercised end-to-end with no database:
 *
 *   ExportRow ──csvLine──▶ CSV text ──parseImportFile──▶ ImportDraftRow
 *
 * and back, for both CSV flavours and for JSON. It also pins the things a
 * future edit could quietly break: the canonical 7-column line staying
 * byte-identical to the format `db:seed` reads (§8), the extended header
 * staying in sync with the writer, and validation rejecting bad rows instead
 * of importing them.
 */
import { parseCsv } from "./csv";
import { formatCsvLine } from "./csv-export";
import {
  EXTENDED_CSV_HEADER,
  EXPORT_SCHEMA_VERSION,
  XLSX_HEADERS,
  buildExportFilename,
  buildExportUrl,
  canonicalCsvLine,
  csvHeader,
  exportRowToJson,
  exportRowToXlsx,
  exportScopeParts,
  extendedCsvLine,
} from "./export-format";
import { importFingerprint, isImportable, parseImportFile } from "./ledger-import";
import type { ExportRow } from "./export-format";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

const row: ExportRow = {
  id: "00000000-0000-4000-8000-0000000000aa",
  date: "2026-08-01",
  time: "09:15:00",
  member: "Dad",
  memberSlug: "dad",
  note: "petrol, full tank",
  amount: "1500.50",
  category: "Fuel",
  categorySlug: "fuel",
  group: "Transport",
  tag: "lifestyle",
  shared: true,
  splitWith: ["dad", "mom"],
  reviewedAt: "2026-08-01T10:00:00.000Z",
  createdAt: "2026-08-01T09:15:00.000Z",
  attachments: [{ pathname: "receipts/2026/08/a.jpg", contentType: "image/jpeg", sizeBytes: 2048 }],
};

function main() {
  /* ------------------------------------------- canonical CSV is frozen ---- */
  // §8: seed.csv's shape is a contract. `db:seed` and `verify:export-live`
  // both depend on this line being produced exactly as before.
  const canonical = canonicalCsvLine(row);
  check(
    canonical ===
      formatCsvLine({
        date: row.date,
        time: row.time,
        member: row.member,
        note: row.note,
        amount: row.amount,
        category: row.category,
        tag: row.tag,
      }),
    "canonicalCsvLine is byte-identical to the pre-§2.10 formatCsvLine",
  );
  check(
    canonical === '2026-08-01,09:15,Dad,"petrol, full tank",1500.50,Fuel,lifestyle',
    "canonical line: HH:MM time, quoted note, 2-dp amount",
  );
  check(csvHeader("canonical") === "date,time,member,item,amount,category,tag", "canonical header is the seed.csv header");

  /* ----------------------------------------------- extended CSV is full ---- */
  const extended = extendedCsvLine(row);
  const extendedFields = parseCsv(extended)[0];
  check(extendedFields.length === 16, `extended line has 16 fields (got ${extendedFields.length})`);
  check(EXTENDED_CSV_HEADER.split(",").length === extendedFields.length, "extended header width matches the writer");
  check(extendedFields[0] === row.id, "extended CSV carries the id (so a restore keeps identity)");
  check(extendedFields[12] === "dad;mom", "split_with is a ;-joined slug list");
  check(extendedFields[11] === "1", "shared is 1/0, not true/false");
  check(extendedFields[13] === row.reviewedAt, "reviewed_at survives as an ISO timestamp");
  check(extendedFields[15] === "receipts/2026/08/a.jpg", "attachment locators are listed");
  // The note contains a comma — it must stay quoted in BOTH flavours.
  check(extended.includes('"petrol, full tank"'), "a comma-bearing note is quoted in the extended flavour too");

  /* ------------------------------------------------------- CSV → import ---- */
  const canonicalFile = [csvHeader("canonical"), canonicalCsvLine(row)].join("\n") + "\n";
  const fromCanonical = parseImportFile("ledger.csv", canonicalFile);
  check(fromCanonical.fatal === undefined, "canonical CSV parses without a fatal error");
  check(fromCanonical.source === "csv-canonical", "a 7-column CSV is detected as canonical (not by extension alone)");

  const backRow = fromCanonical.rows[0];
  check(backRow?.date === row.date, "round trip: date");
  check(backRow?.time === "09:15", "round trip: time normalised to HH:MM");
  check(backRow?.amount === "1500.50", "round trip: amount");
  check(backRow?.note === row.note, "round trip: note (comma and all)");
  check(backRow?.member === "Dad", "round trip: member");
  check(backRow?.category === "Fuel", "round trip: category");
  check(backRow?.tag === "lifestyle", "round trip: tag");
  check(backRow?.id === undefined, "a canonical CSV row has no id (identity falls to the natural key)");
  check(isImportable(backRow!), "the round-tripped row is importable");

  const extendedFile = [csvHeader("extended"), extendedCsvLine(row)].join("\n") + "\n";
  const fromExtended = parseImportFile("ledger.csv", extendedFile);
  check(fromExtended.source === "csv-extended", "a 16-column CSV is detected as extended");
  const backExtended = fromExtended.rows[0];
  check(backExtended?.id === row.id, "round trip: id survives the extended CSV");
  check(backExtended?.shared === true, "round trip: shared");
  check(backExtended?.splitWith.join(";") === "dad;mom", "round trip: split_with");
  check(backExtended?.reviewedAt === row.reviewedAt, "round trip: reviewed_at");
  check(backExtended?.attachments[0] === "receipts/2026/08/a.jpg", "round trip: attachment locator");

  /* ------------------------------------------------------- JSON → import --- */
  const jsonFile = JSON.stringify({
    schema: EXPORT_SCHEMA_VERSION,
    exported_at: "2026-09-01T00:00:00.000Z",
    rows: [exportRowToJson(row)],
    count: 1,
    truncated: false,
  });
  const fromJson = parseImportFile("backup.json", jsonFile);
  check(fromJson.fatal === undefined, "exporter's JSON envelope parses");
  check(fromJson.source === "json", "a .json file is detected as JSON");
  const backJson = fromJson.rows[0];
  check(backJson?.id === row.id, "JSON round trip: id");
  check(backJson?.amount === "1500.50", "JSON round trip: amount (via amount_paise, the lossless path)");
  check(backJson?.categorySlug === "fuel", "JSON round trip: category slug");
  check(backJson?.shared === true, "JSON round trip: shared");
  check(backJson?.splitWith.join(";") === "dad;mom", "JSON round trip: split_with");
  check(backJson?.reviewedAt === row.reviewedAt, "JSON round trip: reviewed_at");
  check(backJson?.attachments.length === 1, "JSON round trip: attachments array");
  check(exportRowToJson(row).amount_paise === 150050, "amount_paise is integer paise, not a float product");

  // A bare array is accepted too (someone hand-exporting from psql).
  check(parseImportFile("rows.json", JSON.stringify([exportRowToJson(row)])).rows.length === 1, "a bare JSON array is accepted");

  /* -------------------------------------------------------- validation ---- */
  const bad = parseImportFile(
    "bad.csv",
    [
      csvHeader("canonical"),
      "2026-13-01,09:15,Dad,new year,100,Fuel,lifestyle", // month 13
      "01-08-2026,09:15,Dad,wrong format,100,Fuel,lifestyle", // not ISO
      "2026-08-01,25:15,Dad,bad hour,100,Fuel,lifestyle", // hour 25
      "2026-08-01,09:15,Dad,bad amount,1,2.3,Fuel,lifestyle", // 8 columns
      "2026-08-01,09:15,Dad,negative,-100,Fuel,lifestyle",
      "2026-08-01,09:15,Dad,unknown tag,100,Fuel,weekly",
      "2026-08-01,09:15,,no member,100,Fuel,lifestyle",
      "2026-08-01,09:15,Dad,uncategorized is fine,100,,lifestyle",
    ].join("\n"),
  );
  check(bad.fatal === undefined, "a file full of bad rows is not fatal");
  check(bad.rows.length === 8, "every row is reported, good or bad");
  check(bad.rows.filter((r) => isImportable(r)).length === 1, "exactly one of the eight rows is importable");
  check(
    bad.rows.filter((r) => !isImportable(r)).length === 7,
    "seven rows are rejected: month 13, non-ISO date, hour 25, wrong width, negative, unknown tag, no member",
  );
  const uncategorized = bad.rows[7];
  check(isImportable(uncategorized) && uncategorized.category === null, "an empty category cell means uncategorized, not invalid");

  // Malformed CSV / JSON fail whole-file, loudly.
  check(parseImportFile("x.csv", 'a,"unterminated').fatal !== undefined, "an unterminated quote is a fatal file error");
  check(parseImportFile("x.json", "{not json").fatal !== undefined, "invalid JSON is a fatal file error");
  check(parseImportFile("x.json", '{"nope":1}').fatal !== undefined, "JSON without a rows array is a fatal file error");
  check(parseImportFile("x.csv", "").fatal !== undefined, "an empty file is a fatal file error");

  /* ------------------------------------------------------- fingerprints --- */
  const fingerprint = importFingerprint({ date: "2026-08-01", time: "09:15", memberId: "m1", amount: "1500.50", note: "petrol" });
  check(
    fingerprint ===
      importFingerprint({ date: "2026-08-01", time: "09:15", memberId: "m1", amount: "1500.5", note: "petrol" }),
    "the natural key ignores amount formatting (1500.5 === 1500.50)",
  );
  check(
    fingerprint !==
      importFingerprint({ date: "2026-08-01", time: "09:15", memberId: "m1", amount: "1500.50", note: null }),
    "a null note is distinguishable from an empty note",
  );
  check(
    fingerprint !== importFingerprint({ date: "2026-08-02", time: "09:15", memberId: "m1", amount: "1500.50", note: "petrol" }),
    "a different date is a different row",
  );

  /* ------------------------------------------------------------- names ---- */
  check(
    buildExportFilename(exportScopeParts({ month: "2026-08", tag: "lifestyle" }), "csv", "2026-09-01") ===
      "ledger-2026-08-lifestyle-2026-09-01.csv",
    "filename describes month + scope + export date",
  );
  check(
    buildExportFilename(exportScopeParts({}), "csv", "2026-09-01", "canonical") === "ledger-all-2026-09-01.canonical.csv",
    "the 7-column flavour is named apart from the full one",
  );
  check(buildExportFilename([], "json", "2026-09-01") === "ledger-all-2026-09-01.json", "an unscoped export is 'all'");
  check(
    buildExportUrl("csv", { month: "2026-08", tag: "lifestyle" }) === "/api/export?month=2026-08&tag=lifestyle&format=csv&columns=extended",
    "the export URL carries the filters plus the format and flavour",
  );
  check(
    buildExportUrl("xlsx", { month: "2026-08" }) === "/api/export?month=2026-08&format=xlsx",
    "xlsx URLs carry no `columns` parameter (it is CSV-only)",
  );

  /* -------------------------------------------------------------- xlsx ---- */
  const cells = exportRowToXlsx(row);
  check(cells.length === XLSX_HEADERS.length, "the xlsx row width matches the xlsx header width");
  check(cells[4] === 1500.5, "the xlsx amount is a number, so the sheet can sum it");
  check(cells[8] === "yes", "the xlsx shared column is yes/no, not 1/0");
  check(cells[12] === 1, "the xlsx receipts column is a count");
  const uncategorizedCells = exportRowToXlsx({ ...row, category: null, group: null });
  check(uncategorizedCells[5] === "Uncategorized", "an uncategorized row is labelled, not left blank");

  if (failures > 0) {
    console.error(`\n✗ Export format test FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log("\n✓ Export format OK — CSV, JSON and the import path round-trip losslessly.");
}

main();
