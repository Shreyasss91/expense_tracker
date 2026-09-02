/**
 * §2.10 — a minimal SpreadsheetML (.xlsx) writer.
 *
 * Emits one worksheet, a frozen bold header row, and inline strings — the
 * smallest set of parts Excel/Sheets/LibreOffice will open without complaint.
 * Inline strings (`t="inlineStr"`) are used deliberately instead of a
 * shared-strings table: it keeps the writer single-pass (no second pass to
 * collect and index every unique string) at the cost of a larger file, which
 * the stored-ZIP trade-off already accepts.
 *
 * Not implemented (and not needed): multiple sheets, merged cells, formulas,
 * per-column styles, charts. If the ledger ever needs those, that is the point
 * to adopt a real spreadsheet library rather than grow this file.
 */
import { zipStore, type ZipEntry } from "./zip";

export type XlsxCell = string | number | boolean | null;

const SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Excel rejects control characters that are legal in XML 1.0 but not in the
 * spreadsheet's own character set — a note pasted from a bank SMS can carry
 * them, so they are dropped rather than allowed to corrupt the workbook.
 * (\t \n \r are deliberately kept: they are legal inside a cell.)
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
function sanitizeText(value: string): string {
  return value.replace(CONTROL_CHARS, "");
}

/** 0 → "A", 25 → "Z", 26 → "AA" (column reference in A1 notation). */
export function columnName(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Excel forbids these in a sheet name, and caps the name at 31 characters. */
function sanitizeSheetName(name: string): string {
  const cleaned = sanitizeText(name).replace(/[[\]:*?/\\]/g, " ").trim();
  return (cleaned || "Sheet1").slice(0, 31);
}

function cellXml(ref: string, value: XlsxCell, bold: boolean): string {
  const style = bold ? ' s="1"' : "";
  if (value === null) return ""; // an empty cell is simply absent
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return ""; // NaN/Infinity are not representable
    return `<c r="${ref}"${style}><v>${value}</v></c>`;
  }
  const text = typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : value;
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(sanitizeText(text))}</t></is></c>`;
}

function sheetXml(rows: XlsxCell[][]): string {
  const body = rows
    .map((row, rowIndex) => {
      if (row.length === 0) return "";
      const cells = row.map((cell, colIndex) => cellXml(`${columnName(colIndex)}${rowIndex + 1}`, cell, rowIndex === 0));
      return `<row r="${rowIndex + 1}">${cells.join("")}</row>`;
    })
    .join("");
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const dimension = maxCols === 0 ? "A1" : `A1:${columnName(maxCols - 1)}${Math.max(rows.length, 1)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${SHEET_NS}"><dimension ref="${dimension}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData>${body}</sheetData></worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${SHEET_NS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/**
 * Build a one-sheet .xlsx workbook.
 *
 * `rows[0]` is treated as the header: it is rendered bold and frozen at the
 * top. Numbers are written as numeric cells so spreadsheets can sum and chart
 * them; everything else becomes text.
 */
export function buildXlsx(sheetName: string, rows: XlsxCell[][]): Uint8Array {
  const encoder = new TextEncoder();
  const put = (xml: string): Uint8Array => encoder.encode(xml);
  const name = escapeXml(sanitizeSheetName(sheetName));

  const entries: ZipEntry[] = [
    {
      name: "[Content_Types].xml",
      data: put(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    },
    {
      name: "_rels/.rels",
      data: put(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    },
    {
      name: "xl/workbook.xml",
      data: put(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${SHEET_NS}" xmlns:r="${OFFICE_REL}"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: put(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${OFFICE_REL}/styles" Target="styles.xml"/></Relationships>`),
    },
    { name: "xl/styles.xml", data: put(STYLES_XML) },
    { name: "xl/worksheets/sheet1.xml", data: put(sheetXml(rows)) },
  ];

  return zipStore(entries);
}
