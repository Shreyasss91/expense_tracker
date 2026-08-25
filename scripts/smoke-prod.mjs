/**
 * Production smoke test — `npm run smoke:prod`.
 *
 * Checks the deployed app end to end over real HTTP:
 *   1. middleware redirects `/` → `/login` on the SAME origin
 *   2. login page renders
 *   3. credentials login succeeds (session cookie issued)
 *   4. dashboard renders all its sections
 *   5. ledger summary is present and never below the SEED BASELINE derived
 *      from seed.csv (entry count + all-time expense) — prod may legitimately
 *      EXCEED the baseline (the daily recurring cron auto-stamps bills, and
 *      humans add expenses), but dropping under it means seeded history was
 *      lost, so that fails loudly.
 *
 * Env:
 *   PROD_URL                 default https://tokenscript.vercel.app
 *   FAMILY_MASTER_PASSWORD   production login password
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { login } from "./lib/live.mjs";
import { parseCsv } from "./lib/csv.mjs";

const BASE = process.env.PROD_URL ?? "https://tokenscript.vercel.app";
const PASSWORD = process.env.FAMILY_MASTER_PASSWORD ?? "";
const BUDGET_MS = Number(process.env.SMOKE_MAX_MS ?? 8000);
const timings = [];

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
    if (fields.length !== 7) throw new Error(`seed row has ${fields.length} fields`);
    return s + Math.round(Number(fields[4]) * 100);
  }, 0);
  const expectedTotal = (expectedPaise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const expectedEntriesStr = expectedEntries.toLocaleString("en-IN");

  console.log(`Smoke: ${BASE} (baseline ≥ ${expectedEntriesStr} entries, all-time expense ≥ ₹${expectedTotal}, budget ${BUDGET_MS}ms/request)`);

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

  // ── PWA installability guard ────────────────────────────────────────────
  // These endpoints MUST stay public and machine-readable: browsers fetch
  // them WITHOUT cookies, and if auth middleware ever intercepts them again
  // (the original "Add to Home Screen never shows" bug) the manifest check
  // below fails loudly instead of the prompt silently disappearing.
  const manifest = await timed("GET /manifest.webmanifest", () =>
    fetch(`${BASE}/manifest.webmanifest`, { signal: AbortSignal.timeout(60000) }),
  );
  check(manifest.status === 200, `GET /manifest.webmanifest → ${manifest.status}`);
  check(
    (manifest.headers.get("content-type") ?? "").includes("application/manifest"),
    `manifest served with a manifest content-type (${manifest.headers.get("content-type")})`,
  );
  let manifestJson = null;
  try {
    manifestJson = JSON.parse(await manifest.text());
  } catch {
    // HTML login page landing here is exactly the regression this guards
  }
  check(manifestJson !== null && manifestJson.name === "Family Ledger", "manifest parses as JSON with the app name");
  check(
    manifestJson !== null && Array.isArray(manifestJson.icons) && manifestJson.icons.length > 0,
    "manifest declares at least one icon",
  );
  const iconHead = await timed("GET /icon", () =>
    fetch(`${BASE}/icon`, { redirect: "manual", signal: AbortSignal.timeout(60000) }),
  );
  check(
    iconHead.status === 200 && (iconHead.headers.get("content-type") ?? "").includes("image/png"),
    `icon route serves a PNG without redirect (${iconHead.status} ${iconHead.headers.get("content-type")})`,
  );
  const sw = await timed("GET /sw.js", () => fetch(`${BASE}/sw.js`, { signal: AbortSignal.timeout(60000) }));
  check(sw.status === 200 && (sw.headers.get("content-type") ?? "").includes("javascript"), `GET /sw.js → ${sw.status} (service worker reachable)`);

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

  // Seed baseline — LOSS detection, not exactness. The daily recurring cron
  // auto-stamps bills and humans add expenses, so prod legitimately grows;
  // falling BELOW the baseline is the only failure (seeded history lost).
  const countMatch = ledgerText.match(/([\d,]+)\s+entries?/);
  check(countMatch !== null, "summary renders an entry count");
  if (countMatch) {
    const actualEntries = Number(countMatch[1].replace(/,/g, ""));
    check(
      actualEntries >= expectedEntries,
      `summary shows ≥ ${expectedEntriesStr} entries (actual ${actualEntries.toLocaleString("en-IN")})`,
    );
  }
  const rupeeMatch = ledgerText.match(/₹\s*([\d,]+\.\d{2})/); // first ₹ on the page = the expense total
  check(rupeeMatch !== null, "summary renders an all-time expense amount");
  if (rupeeMatch) {
    const actualPaise = Math.round(Number(rupeeMatch[1].replace(/,/g, "")) * 100);
    check(
      actualPaise >= expectedPaise,
      `summary shows all-time expense ≥ ₹${expectedTotal} (actual ₹${rupeeMatch[1]})`,
    );
  }

  const slow = timings.filter((t) => t.ms > BUDGET_MS);
  check(slow.length === 0, `all requests within ${BUDGET_MS}ms budget (slowest: ${slow.length ? slow[0].label : "—"})`);
  const summary = timings.map((t) => `${t.label} ${Math.round(t.ms)}ms`).join(", ");

  if (failures > 0) {
    console.error(`✗ Smoke FAILED (${failures} check(s) failed)`);
    console.error(`    timings: ${summary}`);
    process.exitCode = 1;
  } else {
    console.log(
      `✓ Smoke OK — ${BASE} boots, logs in, renders the dashboard, and the ledger holds at least the ` +
        `seeded history (${expectedEntriesStr} entries, ₹${expectedTotal}), all requests within ${BUDGET_MS}ms.`,
    );
    console.log(`    timings: ${summary}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
