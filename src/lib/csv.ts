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
