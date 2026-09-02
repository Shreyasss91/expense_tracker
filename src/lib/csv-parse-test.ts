/**
 * CSV parser test — `npm run test:csv-parse`.
 *
 * §2.10 shipped the read side of the CSV contract (parseCsv) next to the write
 * side that already existed. This proves the two agree, which is the whole
 * basis of "export is no longer one-way": if the shipped writer and the
 * shipped reader disagree about quoting, a restore silently corrupts notes.
 *
 * The expectations are RFC 4180, and the adversarial fixture set is the same
 * one csv-quoting-test.ts uses on the write side.
 */
import { csvField, csvRow, parseCsv } from "./csv";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

const rows: string[][] = [
  ["2026-08-01", "09:15", "Dad", "petrol", "1500.00", "Fuel", "lifestyle"],
  // Comma, embedded quote, newline and leading/trailing space in one field.
  ["2026-08-02", "21:00", "Mom", 'big "party" hall, 2nd floor', "25000.50", "Religion & Gifts", "one_time"],
  ["2026-08-03", "08:00", "Son", "line1\nline2", "99", "", "recurring"],
  ["2026-08-04", "00:00", "Dad", "", "0.05", "Kids", "lifestyle"],
];

function main() {
  // --- Writer → reader round trip, LF records
  const text = rows.map((r) => csvRow(r)).join("\n") + "\n";
  const parsed = parseCsv(text);
  check(JSON.stringify(parsed) === JSON.stringify(rows), "round trip: 4 rows × 7 fields survive csvRow → parseCsv");

  // --- CRLF records parse identically (Excel on Windows writes these)
  const crlf = rows.map((r) => csvRow(r)).join("\r\n") + "\r\n";
  check(JSON.stringify(parseCsv(crlf)) === JSON.stringify(rows), "CRLF records parse identically to LF");

  // --- No trailing newline: the last row is still returned
  check(
    JSON.stringify(parseCsv(rows.map((r) => csvRow(r)).join("\n"))) === JSON.stringify(rows),
    "a file with no trailing newline still yields every row",
  );

  // --- Quoting rules
  check(JSON.stringify(parseCsv('a,"b,c",d')) === JSON.stringify([["a", "b,c", "d"]]), "comma inside quotes is not a delimiter");
  check(JSON.stringify(parseCsv('a,"b""c",d')) === JSON.stringify([["a", 'b"c', "d"]]), "doubled quote is one literal quote");
  check(JSON.stringify(parseCsv('a,"b\nc",d')) === JSON.stringify([["a", "b\nc", "d"]]), "newline inside quotes is not a record break");
  check(JSON.stringify(parseCsv("a, b ,c")) === JSON.stringify([["a", " b ", "c"]]), "spaces are preserved, not trimmed");

  // --- Empty input / empty fields
  check(JSON.stringify(parseCsv("")) === JSON.stringify([]), "empty input yields no rows");
  check(JSON.stringify(parseCsv("a,,c")) === JSON.stringify([["a", "", "c"]]), "an empty field is an empty string");
  check(JSON.stringify(parseCsv("\n")) === JSON.stringify([[""]]), "a lone newline is one empty field, not a crash");

  // --- The writer only quotes when RFC 4180 requires it
  check(csvField("plain") === "plain", "csvField leaves a plain value unquoted");
  check(csvField("a,b") === '"a,b"', "csvField quotes a value containing a comma");
  check(csvField('say "hi"') === '"say ""hi"""', "csvField doubles embedded quotes");

  // --- Malformed input fails loudly rather than guessing
  let threw = false;
  try {
    parseCsv('a,"unterminated,c');
  } catch {
    threw = true;
  }
  check(threw, "an unterminated quoted field throws instead of guessing");

  if (failures > 0) {
    console.error(`\n✗ CSV parser test FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log("\n✓ CSV parser OK — writer and reader agree on RFC 4180.");
}

main();
