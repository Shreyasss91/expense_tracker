/**
 * Live export verification — `npm run verify:export-live`.
 *
 * Answers one question about the deployed app: **is the seeded history still
 * in the export?**
 *
 *   seed.csv ──db:seed──▶ prod DB ──/api/export──▶ CSV ──must still contain──▶ seed.csv rows
 *
 * §2.10 moved export from a Server Action to the streaming GET /api/export
 * route, so the flow is a plain authenticated fetch of
 * `/api/export?format=csv&columns=canonical` (the 7-column seed.csv contract,
 * §6.6) — no more locating the action id inside the live client chunks.
 *
 * This is LOSS DETECTION, not reproduction. Exact reproduction against a fresh
 * seed is already proven in CI by the DB-backed `test:seed-roundtrip`. Prod is
 * a live ledger: the daily recurring cron stamps bills and the household adds
 * and edits entries, so the export legitimately grows past seed.csv — the same
 * reason the smoke test uses a `≥` baseline. What must never happen is a seeded
 * row DISAPPEARING, so:
 *
 *   - the format contract stays exact: canonical header, 7 columns, HH:MM
 *     times, 2-dp amounts, date-ASC ordering, `x-export-truncated: 0`;
 *   - every seeded row must be present — verbatim, or modified in a way that
 *     keeps the transaction's identity: same date, member and amount. Note text
 *     is user-written, and category NAMES are renameable by design (§5.3: the
 *     slug is the identity, the name is a label), so neither can be required to
 *     match;
 *   - a seeded row with no such counterpart is reported as LOST and fails the
 *     run, naming the row. Deleted-vs-edited-beyond-recognition cannot be told
 *     apart from outside the app, so the report says which case it is not.
 *
 * Env:
 *   PROD_URL                 default https://tokenscript.vercel.app
 *   FAMILY_MASTER_PASSWORD   production login password
 *
 * `.env.local` is loaded by `loadLiveEnv()`, which ABORTS when the shell already
 * exports one of its variables with a different value: a stale exported
 * password otherwise surfaces as a login failure blamed on production.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadLiveEnv, login } from "./lib/live.mjs";
import { parseCsv } from "./lib/csv.mjs";

loadLiveEnv();

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

  const client = await login(BASE, PASSWORD);

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

  // 2. Loss detection against seed.csv — see the header for why this is a
  //    subset check, not the equality a freshly seeded database would satisfy.
  const seedCsv = readFileSync(join(process.cwd(), "seed_data", "seed.csv"), "utf8");
  const parsedSeed = parseCsv(seedCsv);
  check(parsedSeed.length > 0, "seed.csv contains a header row");
  const seedRows = parsedSeed.slice(1);
  const exportRows = parsedExport.slice(1);

  const canonical = (f) => [...f.slice(0, 4), Number(f[4]).toFixed(2), ...f.slice(5)];
  const key = (f) => {
    if (f.length !== 7) throw new Error(`expected 7 fields, got ${f.length}: ${f.join("|")}`);
    return canonical(f).join("\u001F");
  };
  const tally = (rows) => {
    const counts = new Map();
    for (const f of rows) counts.set(key(f), (counts.get(key(f)) ?? 0) + 1);
    return counts;
  };
  const seedTally = tally(seedRows);
  const exportTally = tally(exportRows);

  // Seeded rows no longer present one-for-one, and the exported rows that are
  // not seed rows and could therefore account for one.
  const deficits = [];
  for (const [k, needed] of seedTally) {
    for (let n = Math.min(needed, exportTally.get(k) ?? 0); n < needed; n += 1) deficits.push(k.split("\u001F"));
  }
  const extras = [];
  for (const [k, found] of exportTally) {
    for (let n = seedTally.get(k) ?? 0; n < found; n += 1) extras.push(k.split("\u001F"));
  }

  // A transaction's identity as far as it can be seen from outside the app:
  // date, member and amount. Matching on nothing else is deliberate — every
  // remaining field (note, category name, tag, even the time) is editable, and
  // requiring one would report a legitimate edit as lost history.
  const identity = (f) => [f[0], f[2], Number(f[4]).toFixed(2)].join("\u001F");
  const byIdentity = new Map();
  for (const f of extras) {
    const id = identity(f);
    if (!byIdentity.has(id)) byIdentity.set(id, []);
    byIdentity.get(id).push(f);
  }

  // One extra row accounts for at most one missing seed row.
  const spent = new Set();
  const modified = [];
  const lost = [];
  for (const f of deficits) {
    const match = (byIdentity.get(identity(f)) ?? []).find((c) => !spent.has(c));
    if (match) {
      spent.add(match);
      modified.push({ from: f, to: match });
    } else {
      lost.push(f);
    }
  }

  console.log(
    `  ⓘ ${seedRows.length} seeded row(s) checked against ${exportRows.length} exported row(s)`,
  );
  if (modified.length > 0) {
    console.log(`  ⓘ ${modified.length} seeded row(s) present but MODIFIED (same date, member and amount):`);
    for (const { from, to } of modified) {
      console.log(`      ${from[0]}  ${from[2]}  ₹${from[4]}: "${from[3]}" → "${to[3]}"`);
    }
  }
  const grown = extras.length - modified.length;
  if (grown > 0) {
    console.log(
      `  ⓘ ${grown} row(s) beyond seed.csv — expected: the recurring cron stamps bills and the household adds entries`,
    );
  }

  check(
    lost.length === 0,
    lost.length === 0
      ? "every seeded row is still accounted for (verbatim or modified)"
      : `LOST HISTORY — ${lost.length} seeded row(s) absent with no same-date/member/amount counterpart:`,
  );
  for (const f of lost) {
    console.error(`      ${f[0]}  ${f[1]}  ${f[2]}  ${f[3]}  ₹${f[4]}  ${f[5]}  ${f[6]}`);
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
    console.log(
      `✓ Live export OK — ${BASE} exported ${exportRows.length} rows and still accounts for all ` +
        `${seedRows.length} seeded rows (verbatim or modified).`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
