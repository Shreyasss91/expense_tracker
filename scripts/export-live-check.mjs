/**
 * Live export verification — `npm run verify:export-live`.
 *
 * Proves the deployed app's CSV export reproduces `seed.csv`:
 *
 *   seed.csv ──db:seed──▶ prod DB ──/api/export──▶ CSV ──must equal──▶ seed.csv
 *
 * §2.10 moved export from a Server Action to the streaming GET /api/export
 * route, so the flow is now a plain authenticated fetch of
 * `/api/export?format=csv&columns=canonical` (the 7-column seed.csv contract,
 * §6.6) — no more locating the action id inside the live client chunks. The
 * response is compared against seed.csv in canonical form (header, 7 columns,
 * HH:MM times, 2-dp amounts, date-ASC ordering, multiset equality) and the
 * truncation header must say the export was complete. Fails loudly on drift.
 *
 * Env:
 *   PROD_URL                 default https://tokenscript.vercel.app
 *   FAMILY_MASTER_PASSWORD   production login password
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { login } from "./lib/live.mjs";
import { parseCsv } from "./lib/csv.mjs";

const BASE = process.env.PROD_URL ?? "https://tokenscript.vercel.app";
const PASSWORD = process.env.FAMILY_MASTER_PASSWORD ?? "";

let failures = 0;
function check(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

async function main() {
  if (!PASSWORD) {
    throw new Error("no family master password — set FAMILY_MASTER_PASSWORD in .env.local");
  }

  const client = await login(BASE);

  // 1. Stream the canonical CSV from the export route — the same URL the
  //    ledger's "CSV — 7-column" menu item downloads.
  const res = await client.fetch("/api/export?format=csv&columns=canonical");
  check(res.status === 200, `GET /api/export → ${res.status}`);
  if (res.status !== 200) {
    const body = await res.text().catch(() => "");
    throw new Error(`export route failed: ${body.slice(0, 200)}`);
  }
  check(
    res.headers.get("content-type")?.startsWith("text/csv"),
    `content-type is CSV (got ${res.headers.get("content-type")})`,
  );
  check(res.headers.get("x-export-truncated") === "0", "export reports itself as not truncated");
  check(res.headers.get("x-export-rows") !== null, "export reports its row count in x-export-rows");

  const csv = await res.text();
  const parsedExport = parseCsv(csv);
  check(parsedExport.length > 0, "CSV contains at least a header row");
  check(
    JSON.stringify(parsedExport[0]) === JSON.stringify(["date", "time", "member", "item", "amount", "category", "tag"]),
    "CSV starts with the canonical header",
  );

  // 2. Compare with seed.csv in canonical form (multiset, amounts → 2 dp).
  const seedCsv = readFileSync(join(process.cwd(), "seed_data", "seed.csv"), "utf8");
  const parsedSeed = parseCsv(seedCsv);
  check(parsedSeed.length > 0, "seed.csv contains a header row");
  const seedRows = parsedSeed.slice(1);
  const exportRows = parsedExport.slice(1);
  check(exportRows.length === seedRows.length, `row count matches seed.csv (${exportRows.length})`);

  const canonical = (f) => [...f.slice(0, 4), Number(f[4]).toFixed(2), ...f.slice(5)];
  const key = (f) => canonical(f).join("\u001F");
  const seedSorted = seedRows.map((f) => {
    if (f.length !== 7) throw new Error(`seed row has ${f.length} fields`);
    return key(f);
  }).sort();
  const exportSorted = exportRows.map((f) => {
    if (f.length !== 7) throw new Error(`export row has ${f.length} fields`);
    return key(f);
  }).sort();
  const same = JSON.stringify(seedSorted) === JSON.stringify(exportSorted);
  check(same, "export equals seed.csv as a multiset (canonical form)");
  if (!same) {
    for (let i = 0; i < Math.max(seedSorted.length, exportSorted.length); i++) {
      if (seedSorted[i] !== exportSorted[i]) {
        throw new Error(`mismatch at row ${i + 1}:\n  seed  : ${seedSorted[i] ?? "(missing)"}\n  export: ${exportSorted[i] ?? "(missing)"}`);
      }
    }
  }

  // 3. Format spot-checks on the parsed export (dates, times, amounts).
  for (const f of exportRows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f[0])) throw new Error(`bad date: ${f[0]}`);
    if (!/^\d{2}:\d{2}$/.test(f[1])) throw new Error(`bad time: ${f[1]}`);
    if (!/^\d+(\.\d{2})?$/.test(f[4])) throw new Error(`bad amount: ${f[4]}`);
  }
  check(true, "format spot-checks pass (dates, HH:MM times, amounts)");

  const dates = exportRows.map((f) => f[0]);
  const sorted = dates.every((d, i) => i === 0 || dates[i - 1] <= d);
  check(sorted, "export is ordered by date ASC");

  if (failures > 0) {
    console.error(`✗ Live export verification FAILED (${failures} check(s) failed)`);
    process.exitCode = 1;
  } else {
    console.log(`✓ Live export OK — ${BASE} exported ${exportRows.length} rows matching seed.csv (canonical form).`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
