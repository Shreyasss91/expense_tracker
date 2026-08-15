/**
 * RFC 4180 CSV quoting regression test — `npm run test:csv-quoting`.
 *
 * DB-free. Proves that the export quoting (§6.6: any field containing a comma,
 * double quote or newline is quoted; embedded quotes are doubled) round-trips
 * through a REAL RFC 4180-style parser — never a naive split(",").
 *
 * The parser is written by hand and asserted against hand-written CSV strings
 * first, so the parser itself is proven before the serializer is tested
 * against it (no circularity).
 */
import { csvField, csvRow } from "./csv";
import { formatCsvLine, type CsvExportRow } from "./csv-export";

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function ok(msg: string) {
  console.log(`✓ ${msg}`);
}

/**
 * Minimal RFC 4180-style parser: quoted fields, "" escape, LF or CRLF row
 * terminators, commas and newlines inside quotes. Returns rows of fields.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i += 1;
      } else if (ch === ",") {
        row.push(field);
        field = "";
        i += 1;
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        i += 1;
      } else if (ch === "\r") {
        i += 1; // CRLF: the \n terminates the row
      } else {
        field += ch;
        i += 1;
      }
    }
  }
  // Final unterminated row (seed.csv convention: no trailing newline).
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 1. Parser correctness against hand-written RFC 4180 CSV (proves the parser
//    is a real quoted-field parser, not a line splitter).
// ---------------------------------------------------------------------------
const parserCases: { csv: string; expected: string[][] }[] = [
  {
    csv: `"a,b","say ""hi""",plain`,
    expected: [["a,b", 'say "hi"', "plain"]],
  },
  {
    csv: `"line1\r\nline2",after`,
    expected: [["line1\r\nline2", "after"]],
  },
  {
    csv: `a,b\r\n"c,d",e\r\n`,
    expected: [
      ["a", "b"],
      ["c,d", "e"],
    ],
  },
  {
    csv: `"","",""`,
    expected: [["", "", ""]],
  },
];
for (const { csv, expected } of parserCases) {
  const got = parseCsv(csv);
  if (JSON.stringify(got) !== JSON.stringify(expected)) {
    fail(`parser case failed.\n  input:    ${JSON.stringify(csv)}\n  expected: ${JSON.stringify(expected)}\n  got:      ${JSON.stringify(got)}`);
  }
}
ok('parser: quoted fields, double-quote escape, CRLF rows, quoted newlines, empty fields');

// ---------------------------------------------------------------------------
// 2. csvField / csvRow unit behavior.
// ---------------------------------------------------------------------------
const fieldCases: [string, string][] = [
  ["Fuel", "Fuel"],
  ["a,b", '"a,b"'],
  ['say "hi"', '"say ""hi"""'],
  ["a\nb", '"a\nb"'],
  ["a\r\nb", '"a\r\nb"'],
];
for (const [input, expected] of fieldCases) {
  const got = csvField(input);
  if (got !== expected) fail(`csvField(${JSON.stringify(input)}) = ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
}
if (csvRow(["a", "b,c"]) !== 'a,"b,c"') fail(`csvRow join failed: ${csvRow(["a", "b,c"])}`);
ok("csvField/csvRow: plain passthrough, comma/quote/newline quoting, quote doubling, join");

// ---------------------------------------------------------------------------
// 3. Serializer emits exactly the hand-written RFC 4180 lines for adversarial
//    rows (proves formatCsvLine quoting against known-correct CSV).
// ---------------------------------------------------------------------------
const rows: CsvExportRow[] = [
  {
    date: "2026-08-15",
    time: "21:49:00",
    member: "Dad, Sr.",
    type: "expense",
    note: 'Dinner at "Mysore Palace Rd", the "fancy" one',
    amount: "1250.00",
    category: 'Food & "Dining"',
    tag: "lifestyle",
  },
  {
    date: "2026-08-14",
    time: "09:15:00",
    member: "Mom",
    type: "income",
    note: "Refund\nreceived", // newline inside a field
    amount: "500.00",
    category: "Misc",
    tag: null, // income rows export an empty tag (§6.6)
  },
  {
    date: "2026-08-13",
    time: "10:00:00",
    member: "Son",
    type: "expense",
    note: "Toys",
    amount: "300.00",
    category: "Kids",
    tag: "one_time",
  },
];

const expectedLines = [
  `2026-08-15,21:49,"Dad, Sr.",expense,"Dinner at ""Mysore Palace Rd"", the ""fancy"" one",1250.00,"Food & ""Dining""",lifestyle`,
  `2026-08-14,09:15,Mom,income,"Refund\nreceived",500.00,Misc,`,
  `2026-08-13,10:00,Son,expense,Toys,300.00,Kids,one_time`,
];

for (let i = 0; i < rows.length; i++) {
  const line = formatCsvLine(rows[i]);
  if (line !== expectedLines[i]) {
    fail(`formatCsvLine row ${i + 1} mismatch.\n  expected: ${JSON.stringify(expectedLines[i])}\n  got:      ${JSON.stringify(line)}`);
  }
}
ok("formatCsvLine: adversarial member/note/category fields serialize to correct RFC 4180 lines");

// ---------------------------------------------------------------------------
// 4. Full round-trip: serialize ALL rows with the ACTUAL serializer (CRLF
//    records per RFC 4180), then parse with the real parser and compare every
//    field. This is the genuine serializer → CSV document → parser → fields
//    path; section 3 above is the independent known-answer check.
// ---------------------------------------------------------------------------
const csv = rows.map(formatCsvLine).join("\r\n") + "\r\n";
const parsed = parseCsv(csv);
const expectedFields = [
  ["2026-08-15", "21:49", "Dad, Sr.", "expense", 'Dinner at "Mysore Palace Rd", the "fancy" one', "1250.00", 'Food & "Dining"', "lifestyle"],
  ["2026-08-14", "09:15", "Mom", "income", "Refund\nreceived", "500.00", "Misc", ""],
  ["2026-08-13", "10:00", "Son", "expense", "Toys", "300.00", "Kids", "one_time"],
];
if (JSON.stringify(parsed) !== JSON.stringify(expectedFields)) {
  fail(`round-trip mismatch.\n  expected: ${JSON.stringify(expectedFields)}\n  got:      ${JSON.stringify(parsed)}`);
}
ok("round-trip: 3 rows × 8 fields survive formatCsvLine → parse with exact field equality (CRLF records)");

console.log("✓ CSV quoting OK — RFC 4180 quoting round-trips through a real parser.");
process.exitCode = 0;
