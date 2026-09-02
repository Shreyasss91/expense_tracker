/**
 * XLSX / ZIP writer test — `npm run test:xlsx`.
 *
 * §2.10 ships a hand-rolled .xlsx writer rather than a spreadsheet dependency,
 * which makes it the least conventional piece of code in the repo and the one
 * most in need of a test. A malformed workbook fails *at the consumer*, not at
 * build time — Excel just says "file is corrupt" — so this pins the parts of
 * the format that are easy to get wrong:
 *
 *   - CRC-32 (checked against the standard check value)
 *   - the ZIP local header / central directory / EOCD layout and the offsets
 *     that tie them together
 *   - the six required OPC parts and their content types
 *   - inline strings, numeric cells, escaping and control-character stripping
 *   - A1 column names past Z
 */
import { columnName, buildXlsx } from "./xlsx";
import { crc32, zipStore, zipRead } from "./zip";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

const decoder = new TextDecoder();

function main() {
  /* ---------------------------------------------------------------- CRC ---- */
  // The canonical CRC-32 check value: crc32("123456789") === 0xCBF43926.
  check(crc32(new TextEncoder().encode("123456789")) === 0xcbf43926, "crc32 matches the standard check value (0xCBF43926)");
  check(crc32(new Uint8Array(0)) === 0, "crc32 of an empty buffer is 0");

  /* ---------------------------------------------------------------- ZIP ---- */
  const payload = new TextEncoder().encode("<a>hello &amp; goodbye</a>");
  const archive = zipStore([
    { name: "first.xml", data: new Uint8Array([1, 2, 3]) },
    { name: "nested/second.xml", data: payload },
  ]);
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);

  check(view.getUint32(0, true) === 0x04034b50, "archive starts with a local file header signature");
  check(
    view.getUint32(archive.length - 22, true) === 0x06054b50,
    "archive ends with an end-of-central-directory record",
  );
  // EOCD field order from the end: sig(-22), disk(-18), cd-disk(-16),
  // entries-on-disk(-14), total-entries(-12), cd-size(-10), cd-offset(-6),
  // comment-length(-2).
  check(view.getUint16(archive.length - 14, true) === 2, "EOCD records 2 entries on this disk");
  check(view.getUint16(archive.length - 12, true) === 2, "EOCD records 2 entries in total");
  check(view.getUint16(archive.length - 2, true) === 0, "EOCD declares a zero-length comment");

  const centralOffset = view.getUint32(archive.length - 6, true);
  check(view.getUint32(centralOffset, true) === 0x02014b50, "central directory starts where the EOCD says it does");

  // The central directory's per-entry pointer must land on a real local header.
  const firstLocalOffset = view.getUint32(centralOffset + 42, true);
  check(view.getUint32(firstLocalOffset, true) === 0x04034b50, "central directory points back at a local file header");

  const readBack = zipRead(archive);
  check(readBack.size === 2, "zipRead recovers both entries");
  check(decoder.decode(readBack.get("nested/second.xml")) === "<a>hello &amp; goodbye</a>", "stored bytes round-trip exactly");
  check(
    readBack.get("first.xml")?.length === 3 && readBack.get("first.xml")?.[2] === 3,
    "a tiny entry round-trips byte for byte",
  );

  /* ------------------------------------------------------------ columns ---- */
  check(columnName(0) === "A" && columnName(25) === "Z", "columnName handles A..Z");
  check(columnName(26) === "AA" && columnName(27) === "AB", "columnName rolls over past Z");
  check(columnName(701) === "ZZ" && columnName(702) === "AAA", "columnName handles the 3-letter boundary");

  /* --------------------------------------------------------------- XLSX ---- */
  const rows: (string | number | boolean | null)[][] = [
    ["Date", "Item", "Amount", "Reviewed at"],
    ["2026-08-01", "petrol", 1500.5, "2026-08-01T10:00:00.000Z"],
    // Ampersand + a control character: one must be escaped, the other dropped.
    ["2026-08-02", "chai & samosa\u0007", 60, null],
    ["2026-08-03", "emi", 12345, ""],
  ];
  const workbook = buildXlsx('Ledger 2026/08', rows);
  const parts = zipRead(workbook);

  const required = [
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/worksheets/sheet1.xml",
  ];
  for (const name of required) {
    check(parts.has(name), `workbook contains ${name}`);
  }

  const contentTypes = decoder.decode(parts.get("[Content_Types].xml")!);
  check(
    contentTypes.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"),
    "content types declare the workbook part",
  );

  // The sheet name is sanitized: "/" is illegal in Excel and would corrupt it.
  const workbookXml = decoder.decode(parts.get("xl/workbook.xml")!);
  check(workbookXml.includes('name="Ledger 2026 08"'), "illegal sheet-name characters are replaced");
  const emittedSheetName = /<sheet name="([^"]*)"/.exec(workbookXml)?.[1] ?? "";
  check(!/[[\]:*?/\\]/.test(emittedSheetName), "no illegal character survives into the sheet name");
  check(emittedSheetName.length <= 31, "the sheet name is capped at Excel's 31 characters");

  const sheet = decoder.decode(parts.get("xl/worksheets/sheet1.xml")!);

  // Inline strings — no sharedStrings part, so the text lives in the sheet.
  check(sheet.includes('t="inlineStr"'), "strings are written as inline strings");
  check(sheet.includes(">petrol<"), "a plain string cell is present");
  check(sheet.includes("chai &amp; samosa"), "an ampersand is XML-escaped");
  check(!sheet.includes(""), "a control character is stripped, not written");

  // Numbers must be bare <v> cells, or the sheet can't be summed/charted.
  check(sheet.includes("<v>1500.5</v>"), "a decimal amount is a numeric cell");
  check(sheet.includes("<v>12345</v>"), "a whole amount is a numeric cell");
  check(!sheet.includes('t="inlineStr"><is><t>1500.5'), "amounts are not written as text");

  // Header row: bold (s="1") and frozen (pane ySplit=1).
  check(sheet.includes('<pane ySplit="1"'), "the header row is frozen");
  check(/<row r="1">.*s="1"/.test(sheet), "the header row is styled bold");
  check(!/<row r="2">[^<]*<c r="A2" s="1"/.test(sheet), "data rows are not bold");

  // Nulls are simply absent cells — never "<v></v>", which Excel rejects.
  check(!sheet.includes("<v></v>"), "empty cells are omitted rather than written empty");

  /* -------------------------------------------------------- edge cases ---- */
  const empty = zipRead(buildXlsx("Empty", []));
  check(decoder.decode(empty.get("xl/worksheets/sheet1.xml")!).includes('<dimension ref="A1"'), "an empty sheet still declares a valid dimension");

  if (failures > 0) {
    console.error(`\n✗ XLSX test FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log("\n✓ XLSX OK — the generated workbook is a valid, complete OPC package.");
}

main();
