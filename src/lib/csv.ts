/** RFC 4180 quoting — a field containing comma, quote or newline must be quoted (§6.6). */
export function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Join fields into a row with LF line endings (§6.6: UTF-8, LF). */
export function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map((f) => csvField(f == null ? "" : String(f))).join(",");
}

/**
 * §2.10 — the read side of the CSV contract, so an export can come back in.
 *
 * A TypeScript mirror of scripts/lib/csv.mjs (which backs
 * `verify:export-live`): the shipped exporter and the shipped importer must
 * agree on quoting byte for byte, and keeping the two parsers textually
 * identical is the cheapest way to guarantee that.
 *
 * RFC 4180: doubled "" inside a quoted field is one literal quote; a bare CR
 * is dropped so CRLF files (Excel on Windows) parse the same as LF ones.
 * Throws on an unterminated quote rather than guessing where the field ends.
 */
export function parseCsv(text: string): string[][] {
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
      continue;
    }

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
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }

  if (inQuotes) throw new Error("Malformed CSV: unterminated quoted field");

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
