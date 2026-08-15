/**
 * Production smoke test — `npm run smoke:prod`.
 *
 * Checks the deployed app end to end over real HTTP:
 *   1. middleware redirects `/` → `/login`
 *   2. login page renders
 *   3. credentials login succeeds (session cookie issued)
 *   4. dashboard renders all its sections
 *   5. ledger summary shows the EXACT seeded totals, derived from
 *      seed.csv (entry count + all-time expense) — fails loudly if prod
 *      drifts from the audited baseline (not seeded, or new transactions).
 *
 * Env:
 *   PROD_URL          default https://tokenscript.vercel.app
 *   MASTER_PASSWORD   override; falls back to FAMILY_MASTER_PASSWORD in .env.local
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { login } from "./lib/live.mjs";

const BASE = process.env.PROD_URL ?? "https://tokenscript.vercel.app";
const PASSWORD = process.env.MASTER_PASSWORD ?? process.env.FAMILY_MASTER_PASSWORD ?? "";

let failures = 0;
function check(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

// React server-rendered HTML is littered with <!-- --> comment markers; strip
// them so text assertions like "1,157 entries" match contiguously.
function stripReactComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

async function main() {
  if (!PASSWORD) {
    throw new Error("no master password — set MASTER_PASSWORD or FAMILY_MASTER_PASSWORD in .env.local");
  }

  // Expected baseline derived from the canonical seed.csv (§8).
  const lines = readFileSync(join(process.cwd(), "seed_data", "seed.csv"), "utf8")
    .split("\n")
    .slice(1)
    .filter((l) => l.length > 0);
  const expectedEntries = lines.length;
  const expectedPaise = lines.reduce((s, l) => s + Math.round(Number(l.split(",")[5]) * 100), 0);
  const expectedTotal = (expectedPaise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const expectedEntriesStr = expectedEntries.toLocaleString("en-IN");

  console.log(`Smoke: ${BASE} (expect ${expectedEntriesStr} entries, all-time expense ₹${expectedTotal})`);

  // 1. middleware redirect
  const home = await fetch(`${BASE}/`, { redirect: "manual", signal: AbortSignal.timeout(60000) });
  check(home.status === 307, `GET / → ${home.status} (redirect)`);
  const loc = home.headers.get("location") ?? "";
  check(loc.includes("/login"), `redirect target is /login (${loc.slice(0, 60)})`);

  // 2. login page
  const loginPage = await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(60000) });
  const loginHtml = await loginPage.text();
  check(loginPage.status === 200, `GET /login → ${loginPage.status}`);
  check(/Family Ledger/i.test(loginHtml) && /password/i.test(loginHtml), "login page renders the form");

  // 3. credentials login
  const client = await login(BASE, PASSWORD);
  check(true, "credentials login succeeded (session cookie issued)");

  // 4. dashboard sections
  const dash = await client.fetch("/");
  const dashText = stripReactComments(await dash.text());
  check(dash.status === 200, `GET / (authed) → ${dash.status}`);
  check(
    ["Overview", "Tag breakdown", "6-month trend", "Transactions"].every((s) => dashText.includes(s)),
    "dashboard renders all sections",
  );

  // 5. ledger summary = seeded totals
  const ledger = await client.fetch("/transactions");
  const ledgerText = stripReactComments(await ledger.text());
  check(ledger.status === 200, `GET /transactions → ${ledger.status}`);
  check(ledgerText.includes("All time"), "ledger summary shows all-time scope");
  check(ledgerText.includes(`${expectedEntriesStr} entries`), `summary shows ${expectedEntriesStr} entries`);
  check(ledgerText.includes(expectedTotal), `summary shows all-time expense ₹${expectedTotal}`);

  if (failures > 0) {
    console.error(`✗ Smoke FAILED (${failures} check(s) failed)`);
    process.exitCode = 1;
  } else {
    console.log(
      `✓ Smoke OK — ${BASE} boots, logs in, and renders the seeded totals (${expectedEntriesStr} entries, ₹${expectedTotal}).`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
