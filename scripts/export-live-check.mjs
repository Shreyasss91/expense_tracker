/**
 * Live export verification — `npm run verify:export-live`.
 *
 * Proves the deployed app's CSV export reproduces `seed.csv`:
 *
 *   seed.csv ──db:seed──▶ prod DB ──exportCsv action──▶ CSV ──must equal──▶ seed.csv
 *
 * Flow: login to the deployed app, locate the `exportCsv` action id inside
 * the live client chunks, invoke it through React's own encodeReply wire
 * format, then compare the returned CSV against seed.csv in canonical form
 * (header, 7 columns, HH:MM times, 2-dp amounts, date-ASC ordering,
 * multiset equality). Fails loudly on any drift.
 *
 * Env:
 *   PROD_URL                 default https://kharchubook.vercel.app
 *   FAMILY_MASTER_PASSWORD   production login password
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { login } from "./lib/live.mjs";
import { parseCsv } from "./lib/csv.mjs";

const require = createRequire(import.meta.url);
const { encodeReply } = require("next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.node.unbundled.development.js");

const BASE = process.env.PROD_URL ?? "https://kharchubook.vercel.app";
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

  const client = await login(BASE, PASSWORD);

  // 1. Find the exportCsv action id in the live client chunks.
  const page = await client.fetch("/transactions");
  const html = await page.text();
  const chunkUrls = [...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+\.js)"/g)].map((m) => m[1]);
  let actionId = null;
  for (const u of chunkUrls) {
    const res = await client.fetch(u);
    const src = await res.text();
    const m = src.match(/createServerReference\)\("([0-9a-f]{40,})"[^)]*?"exportCsv"\)/);
    if (m) {
      actionId = m[1];
      break;
    }
  }
  check(actionId !== null, "located exportCsv action id in the live chunks");
  if (!actionId) throw new Error("exportCsv action id not found in any chunk");

  // 2. Invoke the action with React's own zero-arg wire encoding.
  const body = await encodeReply([]);
  const res = await client.fetch("/transactions", {
    method: "POST",
    headers: { "Next-Action": actionId, "Content-Type": "text/plain;charset=UTF-8" },
    body,
  });
  const text = await res.text();
  check(res.status === 200, `exportCsv action → ${res.status}`);

  // 3. The Flight response embeds the CSV as a T-row: `2:T<hexlen>,<csv>`.
  const m = text.match(/2:T([0-9a-f]+),(.*)$/s);
  check(m !== null, "parsed CSV out of the Flight response");
  if (!m) throw new Error(`unexpected action response: ${text.slice(0, 120)}`);
  const csv = m[2].slice(0, parseInt(m[1], 16));
  const parsedExport = parseCsv(csv);
  check(parsedExport.length > 0, "CSV contains at least a header row");
  check(
    JSON.stringify(parsedExport[0]) === JSON.stringify(["date", "time", "member", "item", "amount", "category", "tag"]),
    "CSV starts with the canonical header",
  );

  // 4. Compare with seed.csv in canonical form (multiset, amounts → 2 dp).
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

  // 5. Format spot-checks on the parsed export (dates, times, amounts).
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
