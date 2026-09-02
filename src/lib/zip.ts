/**
 * §2.10 — a dependency-free ZIP writer (method 0 = "stored", no compression).
 *
 * Why this exists: XLSX is a ZIP container of XML parts. The project runs on a
 * deliberately lean dependency list, and pulling a full spreadsheet library
 * (thousands of modules, most of it unused) to emit one flat sheet with a bold
 * header row is a bad trade. "Stored" entries are legal per APPNOTE.TXT 4.4.4
 * and every consumer that opens .xlsx (Excel, Google Sheets, LibreOffice,
 * Numbers, the `unzip` CLI) reads them.
 *
 * The trade-off is file size: a 100k-row sheet stays uncompressed, so it is
 * roughly 3–4× larger than a deflated one. That is acceptable — the export is
 * bounded by EXPORT_ROW_CAP (see export-format.ts) and is generated on demand.
 *
 * Deliberately out of scope, and documented as such:
 *  - ZIP64 (>4 GiB members / >65535 entries). The row cap keeps us far below.
 *  - Data descriptors (streaming). A ZIP's central directory lives at the END
 *    of the file and records each member's CRC and size, so a truly streaming
 *    ZIP needs the "sizes follow the data" bit. Doing that correctly here
 *    would buy nothing: the XLSX is built from an in-memory row array anyway.
 */

/** Fixed DOS timestamp (2020-01-01 00:00) so exports are byte-reproducible. */
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1; // 0x5021

/** UTF-8 filenames (language encoding flag, bit 11). */
const FLAG_UTF8 = 0x0800;

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let bit = 0; bit < 8; bit += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

/** Standard CRC-32 (IEEE 802.3, reflected) over a byte array. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Path inside the archive, e.g. "xl/worksheets/sheet1.xml". */
  name: string;
  data: Uint8Array;
}

/**
 * Serialize entries into a single ZIP archive. The buffer is sized exactly
 * once up front (every part's length is known) so there is no growth/copy
 * churn even for multi-megabyte sheets.
 */
export function zipStore(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts = entries.map((entry) => ({ name: encoder.encode(entry.name), data: entry.data }));

  let localBytes = 0;
  let centralBytes = 0;
  for (const part of parts) {
    localBytes += 30 + part.name.length + part.data.length;
    centralBytes += 46 + part.name.length;
  }

  const out = new Uint8Array(localBytes + centralBytes + 22);
  const view = new DataView(out.buffer);
  let at = 0;

  // --- Local file headers + payloads (APPNOTE 4.3.7)
  const localOffsets: number[] = [];
  for (const part of parts) {
    localOffsets.push(at);
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, 20, true); // version needed to extract
    view.setUint16(at + 6, FLAG_UTF8, true);
    view.setUint16(at + 8, 0, true); // method 0 = stored
    view.setUint16(at + 10, DOS_TIME, true);
    view.setUint16(at + 12, DOS_DATE, true);
    view.setUint32(at + 14, crc32(part.data), true);
    view.setUint32(at + 18, part.data.length, true); // compressed size
    view.setUint32(at + 22, part.data.length, true); // uncompressed size
    view.setUint16(at + 26, part.name.length, true);
    view.setUint16(at + 28, 0, true); // extra field length
    out.set(part.name, at + 30);
    out.set(part.data, at + 30 + part.name.length);
    at += 30 + part.name.length + part.data.length;
  }

  // --- Central directory (APPNOTE 4.3.12)
  const centralStart = at;
  parts.forEach((part, index) => {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, 20, true); // version made by
    view.setUint16(at + 6, 20, true); // version needed
    view.setUint16(at + 8, FLAG_UTF8, true);
    view.setUint16(at + 10, 0, true); // method
    view.setUint16(at + 12, DOS_TIME, true);
    view.setUint16(at + 14, DOS_DATE, true);
    view.setUint32(at + 16, crc32(part.data), true);
    view.setUint32(at + 20, part.data.length, true);
    view.setUint32(at + 24, part.data.length, true);
    view.setUint16(at + 28, part.name.length, true);
    view.setUint16(at + 30, 0, true); // extra
    view.setUint16(at + 32, 0, true); // comment
    view.setUint16(at + 34, 0, true); // disk number start
    view.setUint16(at + 36, 0, true); // internal attrs
    view.setUint32(at + 38, 0, true); // external attrs
    view.setUint32(at + 42, localOffsets[index], true);
    out.set(part.name, at + 46);
    at += 46 + part.name.length;
  });

  // --- End of central directory record (APPNOTE 4.3.16)
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 4, 0, true); // this disk
  view.setUint16(at + 6, 0, true); // disk with the central directory
  view.setUint16(at + 8, parts.length, true);
  view.setUint16(at + 10, parts.length, true);
  view.setUint32(at + 12, at - centralStart, true); // central directory size
  view.setUint32(at + 16, centralStart, true); // offset of the central directory
  view.setUint16(at + 20, 0, true); // comment length

  return out;
}

/** Read back a stored-only archive — used by the round-trip test (not shipped logic). */
export function zipRead(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found = new Map<string, Uint8Array>();
  let at = 0;
  while (at + 30 <= bytes.length) {
    if (view.getUint32(at, true) !== 0x04034b50) break;
    const nameLength = view.getUint16(at + 26, true);
    const size = view.getUint32(at + 22, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength));
    found.set(name, bytes.subarray(at + 30 + nameLength, at + 30 + nameLength + size));
    at += 30 + nameLength + size;
  }
  return found;
}
