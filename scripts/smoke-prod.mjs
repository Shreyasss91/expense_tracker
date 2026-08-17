/**
 * Production smoke test — `npm run smoke:prod`.
 *
 * Checks the deployed app end to end over real HTTP:
 *   1. middleware redirects `/` → `/login` on the SAME origin
 *   2. login page renders
 *   3. credentials login succeeds (session cookie issued)
 *   4. dashboard renders all its sections
 *   5. ledger summary shows the EXACT seeded totals, derived from
 *      seed.csv (entry count + all-time expense) — fails loudly if prod
 *      drifts from the audited baseline (not seeded, or new transactions).
 *
 * Env:
 *   PROD_URL                 default https://kharchubook.vercel.app
 *   FAMILY_MASTER_PASSWORD   production login password
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { login } from "./lib/live.mjs";

const BASE = process.env.PROD_URL ?? "https://kharchubook.vercel.app";
const PASSWORD = process.env.FAMILY_MASTER_PASSWORD ?? "";
const BUDGET_MS = Number(process.env.SMOKE_MAX_MS ?? 8000);
const timings = [];

function parseCsv(text) {
  const rows = [];
  let row = [];
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
    } else if (ch === '"') {
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
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function record(label, ms, cache) {
  timings.push({ label, ms });
  const flag = ms > BUDGET_MS ? "  ✗ SLOW" : "";
  console.log(`    ⏱ ${label}: ${Math.round(ms)}ms${cache ? ` (${cache})` : ""}${flag}`);
}

async function timed(label, fn) {
  const t0 = performance.now();
  const res = await fn();
  record(label, performance.now() - t0, res.headers.get("x-vercel-cache") ?? undefined);
  return res;
}

let failures = 0;
function check(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

function stripReactComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

async function main() {
  if (!PASSWORD) {
    throw new Error("no family master password — set FAMILY_MASTER_PASSWORD");
  }

  const seedCsv = readFileSync(join(process.cwd(), "seed_data", "seed.csv"), "utf8");
  const seedRows = parseCsv(seedCsv).slice(1);
  const expectedEntries = seedRows.length;
  const expectedPaise = seedRows.reduce((s, fields) => {
    if (fields.length !== 8) throw new Error(`seed row has ${fields.length} fields`);
    return s + Math.round(Number(fields[5]) * 100);
  }, 0);
  const expectedTotal = (expectedPaise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const expectedEntriesStr = expectedEntries.toLocaleString("en-IN");

  console.log(`Smoke: ${BASE} (expect ${expectedEntriesStr} entries, all-time expense ₹${expectedTotal}, budget ${BUDGET_MS}ms/request)`);

  const home = await timed("GET / (redirect)", () => fetch(`${BASE}/`, { redirect: "manual", signal: AbortSignal.timeout(60000) }));
  check(home.status === 307, `GET / → ${home.status} (redirect)`);
  const loc = home.headers.get("location") ?? "";
  let redirectUrl;
  try {
    redirectUrl = new URL(loc, BASE);
  } catch {
    redirectUrl = null;
  }
  const baseUrl = new URL(BASE);
  check(
    redirectUrl !== null && redirectUrl.origin === baseUrl.origin && redirectUrl.pathname === "/login",
    `redirect target is same-origin /login (${loc.slice(0, 120)})`,
  );

  const loginPage = await timed("GET /login", () => fetch(`${BASE}/login`, { signal: AbortSignal.timeout(60000) }));
  const loginHtml = await loginPage.text();
  check(loginPage.status === 200, `GET /login → ${loginPage.status}`);
  check(/Family Ledger/i.test(loginHtml) && /password/i.test(loginHtml), "login page renders the form");

  const client = await login(BASE, PASSWORD);
  const timedFetch = (path) => timed(`GET ${path}`, () => client.fetch(path));
  check(true, "credentials login succeeded (session cookie issued)");

  const dash = await timedFetch("/");
  const dashText = stripReactComments(await dash.text());
  check(dash.status === 200, `GET / (authed) → ${dash.status}`);
  check(
    ["Overview", "Tag breakdown", "6-month trend", "Transactions"].every((s) => dashText.includes(s)),
    "dashboard renders all sections",
  );

  const ledger = await timedFetch("/transactions");
  const ledgerText = stripReactComments(await ledger.text());
  check(ledger.status === 200, `GET /transactions → ${ledger.status}`);
  check(ledgerText.includes("All time"), "ledger summary shows all-time scope");
  check(ledgerText.includes(`${expectedEntriesStr} entries`), `summary shows ${expectedEntriesStr} entries`);
  check(ledgerText.includes(expectedTotal), `summary shows all-time expense ₹${expectedTotal}`);

  const slow = timings.filter((t) => t.ms > BUDGET_MS);
  check(slow.length === 0, `all requests within ${BUDGET_MS}ms budget (slowest: ${slow.length ? slow[0].label : "—"})`);
  const summary = timings.map((t) => `${t.label} ${Math.round(t.ms)}ms`).join(", ");

  if (failures > 0) {
    console.error(`✗ Smoke FAILED (${failures} check(s) failed)`);
    console.error(`    timings: ${summary}`);
    process.exitCode = 1;
  } else {
    console.log(
      `✓ Smoke OK — ${BASE} boots, logs in, renders the seeded totals (${expectedEntriesStr} entries, ₹${expectedTotal}), ` +
        `all requests within ${BUDGET_MS}ms.`,
    );
    console.log(`    timings: ${summary}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
