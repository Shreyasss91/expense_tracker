import { NextResponse } from "next/server";

/**
 * §2.10 — /api/export: the streaming export endpoint.
 *
 * Why a Route Handler instead of a Server Action: a Server Action must
 * materialise its whole return value before React can serialise it, which is
 * exactly the unbounded-memory problem this fixes. A GET handler can hand back
 * a ReadableStream, so rows are pulled from Postgres in batches, encoded, and
 * pushed to the client — peak memory is one batch, not the whole ledger.
 *
 * It is a plain `<a href download>` target, so it works without JS, honours
 * the session cookie (§1.5: never a public, guessable URL), and accepts the
 * ledger's own query string — `/api/export?format=csv&month=2026-08&tag=lifestyle`
 * exports precisely what that URL shows.
 *
 *   ?format=csv|json|xlsx        (default csv)
 *   ?columns=extended|canonical  (csv only; canonical = the 7-column seed.csv
 *                                 contract that `db:seed` reads back)
 *   + every ledger filter: month, member, category, category=uncategorized,
 *     group, tag, from, to, amount_min, amount_max, q
 */
import { auth } from "@/auth";
import { todayInIST } from "@/lib/dates";
import { parseLedgerSearchParams } from "@/lib/ledger-url";
import { countExportRows, iterateExportRows } from "@/lib/export-rows";
import { buildXlsx, type XlsxCell } from "@/lib/xlsx";
import {
  EXPORT_MIME,
  EXPORT_ROW_CAP,
  EXPORT_SCHEMA_VERSION,
  XLSX_HEADERS,
  buildExportFilename,
  csvHeader,
  csvLine,
  exportRowToJson,
  exportRowToXlsx,
  exportScopeParts,
  type CsvFlavour,
  type ExportFormat,
} from "@/lib/export-format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const encoder = new TextEncoder();

function parseFormat(value: string | null): ExportFormat {
  return value === "json" || value === "xlsx" ? value : "csv";
}

function parseFlavour(value: string | null): CsvFlavour {
  return value === "canonical" ? "canonical" : "extended";
}

/** CSV rows are streamed: header, then one chunk per DB batch. */
async function* csvChunks(filters: Parameters<typeof iterateExportRows>[0], flavour: CsvFlavour, cap: number) {
  yield encoder.encode(`${csvHeader(flavour)}\n`);
  for await (const batch of iterateExportRows(filters, { cap })) {
    if (batch.length === 0) continue;
    yield encoder.encode(`${batch.map((row) => csvLine(row, flavour)).join("\n")}\n`);
  }
}

/**
 * JSON is streamed too — the rows array is written incrementally so the object
 * is still valid JSON if the caller closes the connection early (it won't be,
 * but nothing buffers the whole payload in the meantime either).
 */
async function* jsonChunks(filters: Parameters<typeof iterateExportRows>[0], cap: number, exportedAt: string) {
  yield encoder.encode(
    `{"schema":${JSON.stringify(EXPORT_SCHEMA_VERSION)},"exported_at":${JSON.stringify(exportedAt)},"rows":[`,
  );
  let first = true;
  let count = 0;
  for await (const batch of iterateExportRows(filters, { cap })) {
    if (batch.length === 0) continue;
    const body = batch.map((row) => JSON.stringify(exportRowToJson(row))).join(",");
    yield encoder.encode(`${first ? "" : ","}${body}`);
    first = false;
    count += batch.length;
  }
  yield encoder.encode(`],"count":${count},"truncated":${count >= cap}}`);
}

async function* singleChunk(bytes: Uint8Array) {
  yield bytes;
}

function toStream(source: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await source.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    async cancel() {
      await source.return?.(undefined);
    },
  });
}

export async function GET(request: Request) {
  // §1.5 — the ledger is behind one master password; the export is no looser.
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const raw: Record<string, string | undefined> = {};
  url.searchParams.forEach((value, key) => {
    raw[key] = value;
  });
  const { filters } = parseLedgerSearchParams(raw);

  const format = parseFormat(url.searchParams.get("format"));
  const flavour = parseFlavour(url.searchParams.get("columns"));
  const today = todayInIST();
  const filename = buildExportFilename(exportScopeParts(filters), format, today, flavour);

  // Counted up front so truncation is reported in a header rather than lost.
  const total = await countExportRows(filters);
  const truncated = total > EXPORT_ROW_CAP;

  const headers = new Headers({
    "content-type": EXPORT_MIME[format],
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "no-store",
    "x-export-rows": String(total),
    "x-export-truncated": truncated ? "1" : "0",
  });

  if (format === "xlsx") {
    // XLSX can't be streamed — its ZIP central directory records each part's
    // CRC and size, which are only known once every part is written. The row
    // cap is what keeps this bounded (see src/lib/zip.ts).
    const sheet: XlsxCell[][] = [XLSX_HEADERS];
    for await (const batch of iterateExportRows(filters, { cap: EXPORT_ROW_CAP })) {
      for (const row of batch) sheet.push(exportRowToXlsx(row));
    }
    return new Response(toStream(singleChunk(buildXlsx(`Ledger ${exportScopeParts(filters)[0]}`, sheet))), {
      headers,
    });
  }

  const body =
    format === "json" ? jsonChunks(filters, EXPORT_ROW_CAP, new Date().toISOString()) : csvChunks(filters, flavour, EXPORT_ROW_CAP);

  return new Response(toStream(body), { headers });
}
