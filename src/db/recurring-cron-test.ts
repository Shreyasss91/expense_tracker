/**
 * `/api/cron/recurring` — the daily auto-stamp, driven for real —
 * `npm run test:recurring-cron`.
 *
 * This route writes to the ledger unattended, at 06:00 IST, and every one of its
 * guarantees is a *database* fact: one transaction per (template, month) even
 * across a crash or a concurrent run, a marker that stops a second stamp, a
 * one-shot `skip_month` that is consumed exactly once, and paused/variable
 * templates that must never fire. None of that is reachable from a pure test,
 * and nothing else exercises the route at all.
 *
 * **The safety design comes first, because the fixture runs against a real
 * ledger.** Four things make it safe to run anywhere:
 *
 *   1. **It stamps nothing real.** The suite reads every existing template's
 *      `auto_day` and picks a day of the month no template uses, so the route's
 *      `auto_day = day` query can only match the fixtures. If 28 days are taken
 *      it refuses to run rather than guess. The date used is a throwaway
 *      `2099-*` month, per the repo's convention for test rows.
 *   2. **It snapshot-restores every pre-existing template.** The route's
 *      housekeeping UPDATE (`auto_day IS NULL` → clear `last_auto_key`) is not
 *      scoped to the fixtures, so every template's marker is read before the run
 *      and any that differs is written back, then verified equal. That is
 *      reported rather than asserted-at-zero, because whether it fires depends
 *      on real data.
 *   3. **It deletes exactly what it created**, by the deterministic
 *      `(template, month)` ids it can compute in advance, and then counts them
 *      again.
 *   4. Nothing survives to be seen by the 22:00 IST feed, and the inserts log no
 *      activity — the route writes rows directly, and the cleanup deletes
 *      directly, so `activity_log` is never involved.
 *
 * **What it can and cannot prove about the revalidation.** `revalidateTag` needs
 * Next's request store, so in this bare Node process the real call throws and the
 * `refreshAfterWrite` guard logs it. The test asserts the run still answered
 * `200` *and* that the log line naming the auto-stamp appeared — which is what
 * shows the guarded thunk really ran, in the route as shipped. It cannot show
 * the tags reaching a live cache, because there is no cache here; that is the
 * framework's, and `test:cache-tags` covers the shape.
 *
 * `--conditions=react-server` because the route imports `@/lib/cache-refresh`
 * and `@/db`, both `server-only`; `./load-env` must stay the FIRST import so
 * `DATABASE_URL` is set before the neon client is constructed.
 *
 * Needs a seeded database and `.env.local`.
 */
import "./load-env";
import { assertNotProductionDb } from "./test-db-guard";

assertNotProductionDb("recurring-cron-test");

import { asc, eq, inArray } from "drizzle-orm";
import { GET } from "@/app/api/cron/recurring/route";
import { db } from "@/db";
import { categories, members, templates, transactions } from "./schema";
import { recurringTransactionId } from "@/lib/recurring-identity";
import { isGenericNote } from "@/lib/generic-notes";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

/** A dummy credential — the route compares against whatever the process holds. */
const TOKEN = "zz-test-cron-secret-0123456789";

/** Throwaway month, so the stamped rows can never collide with real ones. */
const MONTH = "2099-06";

/**
 * A note the review queue treats as REAL detail (so `reviewed_at` must be set),
 * and one it treats as generic (so it must stay NULL) — §1.11's fix, which is
 * exactly the kind of thing a cron gets wrong quietly.
 */
const DETAILED_NOTE = "zz recurring probe subscription";
const GENERIC_NOTE = "misc";

async function captureWarnings<T>(fn: () => Promise<T>): Promise<{ result: T; warnings: string[] }> {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  try {
    return { result: await fn(), warnings };
  } finally {
    console.warn = original;
  }
}

async function callCron(date: string, authorization: string | null = `Bearer ${TOKEN}`) {
  const headers: Record<string, string> = {};
  if (authorization) headers.authorization = authorization;
  const response = await GET(new Request(`https://example.test/api/cron/recurring?date=${date}`, { headers }));
  let json: Record<string, unknown> = {};
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    // A non-JSON response is one of the cases under test.
  }
  return { status: response.status, json };
}

const ids = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);

async function transactionById(id: string) {
  const rows = await db.select().from(transactions).where(eq(transactions.id, id));
  return rows[0] ?? null;
}

async function templateById(id: string) {
  const rows = await db.select().from(templates).where(eq(templates.id, id));
  return rows[0] ?? null;
}

async function main() {
  const originalSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = TOKEN;

  const cat = (await db.select().from(categories).limit(1))[0];
  if (!cat) throw new Error("no categories — run npm run db:seed");
  const member = (await db.select().from(members).orderBy(asc(members.sortOrder)).limit(1))[0];
  if (!member) throw new Error("no members — run npm run db:seed");

  // --- Safety, before anything is written ---------------------------------
  const snapshot = await db
    .select({ id: templates.id, lastAutoKey: templates.lastAutoKey, skipMonth: templates.skipMonth })
    .from(templates);
  const usedDays = new Set(
    (await db.select({ autoDay: templates.autoDay }).from(templates))
      .map((r) => r.autoDay)
      .filter((d): d is number => d !== null),
  );
  const freeDays = Array.from({ length: 28 }, (_, i) => i + 1).filter((d) => !usedDays.has(d));
  if (freeDays.length < 2) {
    throw new Error(
      `every day 1–28 is used by a real template's auto_day (${usedDays.size} days) — refusing to run, ` +
        `because the route's day query could match a real bill`,
    );
  }
  const day = freeDays[0];
  const otherDay = freeDays[1];
  const date = `${MONTH}-${String(day).padStart(2, "0")}`;

  const fixtureIds: string[] = [];
  let stampedId = "";
  let genericId = "";

  try {
    console.log("\nSafety");
    check(
      !usedDays.has(day) && !usedDays.has(otherDay),
      `the fixture days (${day}, ${otherDay}) are not used by any of the ${snapshot.length} real templates`,
    );
    check(!isGenericNote(DETAILED_NOTE) && isGenericNote(GENERIC_NOTE), "the two fixture notes really are detailed and generic");

    // --- Fixtures ---------------------------------------------------------
    const base = { categoryId: cat.id, tag: "recurring" as const, amount: "1234.00" };
    const rows = await db
      .insert(templates)
      .values([
        { ...base, name: "zz cron probe — stamps", note: DETAILED_NOTE, autoDay: day, sortOrder: 9001 },
        { ...base, name: "zz cron probe — paused", note: DETAILED_NOTE, autoDay: day, isPaused: true, sortOrder: 9002 },
        { ...base, name: "zz cron probe — variable", note: DETAILED_NOTE, autoDay: day, isVariable: true, sortOrder: 9003 },
        { ...base, name: "zz cron probe — skip month", note: DETAILED_NOTE, autoDay: day, skipMonth: MONTH, sortOrder: 9004 },
        { ...base, name: "zz cron probe — other day", note: DETAILED_NOTE, autoDay: otherDay, sortOrder: 9005 },
        { ...base, name: "zz cron probe — already stamped", note: DETAILED_NOTE, autoDay: day, lastAutoKey: MONTH, sortOrder: 9006 },
        { ...base, name: "zz cron probe — generic note", note: GENERIC_NOTE, autoDay: day, amount: "77.00", sortOrder: 9007 },
      ])
      .returning();

    const [stamps, paused, variable, skipped, otherDayRow, alreadyStamped, generic] = rows;
    fixtureIds.push(...rows.map((r) => r.id));
    stampedId = recurringTransactionId(stamps.id, MONTH);
    genericId = recurringTransactionId(generic.id, MONTH);

    check((await transactionById(stampedId)) === null, "the fixture transaction id does not already exist");

    // --- First run --------------------------------------------------------
    console.log("\nFirst run — one stamp per due template");
    const { result: first, warnings } = await captureWarnings(() => callCron(date));
    check(first.status === 200, `the run answers 200 (got ${first.status})`);
    check(first.json.ok === true, "and reports ok");
    check(first.json.created === 2, `it stamps the two live templates (created=${first.json.created})`);
    check(first.json.due === 5, `five templates are due: stamps, paused, variable, skip, generic (due=${first.json.due})`);

    const skippedIds = ids(first.json.skipped);
    check(
      [paused.id, variable.id, skipped.id].every((id) => skippedIds.includes(id)),
      "paused, variable and skip_month templates are all skipped",
    );
    check(
      !skippedIds.includes(alreadyStamped.id) && !skippedIds.includes(otherDayRow.id),
      "an already-stamped month and another day's template are not even due",
    );

    // The revalidation ran in the route as shipped. In this process the real
    // call throws (no request store), so the guard's log line is the proof.
    check(
      warnings.some((w) => w.includes(`recurring auto-stamp ${date}`)),
      "the guarded cache refresh ran and logged instead of failing the run",
    );

    // --- What landed ------------------------------------------------------
    console.log("\nWhat landed — the rows themselves");
    const stamped = await transactionById(stampedId);
    check(stamped !== null, "the stamped row exists under its deterministic (template, month) id");
    check(stamped?.amount === "1234.00", `amount comes from the template (${stamped?.amount})`);
    check(stamped?.date === date, `date is the run's date (${stamped?.date})`);
    check(stamped?.tag === "recurring", "tag comes from the template");
    check(stamped?.categoryId === cat.id, "category comes from the template");
    check(stamped?.memberId === member.id, "a template with no member lands under the household default");
    check(/^\d{2}:\d{2}:00$/.test(stamped?.time ?? ""), `time is normalized to HH:MM:SS (${stamped?.time})`);
    check(stamped?.reviewedAt !== null && stamped?.reviewedAt !== undefined, "a real note marks the row reviewed (§1.11)");

    const genericRow = await transactionById(genericId);
    check(genericRow !== null, "the generic-note template stamps too");
    check(genericRow?.reviewedAt === null, "a generic note leaves the row PENDING review (§1.11)");

    check((await transactionById(recurringTransactionId(paused.id, MONTH))) === null, "the paused template created nothing");
    check((await transactionById(recurringTransactionId(variable.id, MONTH))) === null, "the variable template created nothing");
    check((await transactionById(recurringTransactionId(skipped.id, MONTH))) === null, "the skipped month created nothing");

    const skippedRow = await templateById(skipped.id);
    check(skippedRow?.skipMonth === null, "the one-shot skip_month was consumed");
    check(skippedRow?.lastAutoKey === MONTH, "and the skip still advanced the month marker");
    check((await templateById(otherDayRow.id))?.lastAutoKey === null, "another day's template was untouched");
    check((await templateById(alreadyStamped.id))?.lastAutoKey === MONTH, "an already-stamped month kept its marker");

    // --- Second run: idempotency -----------------------------------------
    console.log("\nSecond run — the same day again");
    const second = await callCron(date);
    check(second.json.created === 0, `nothing is stamped twice (created=${second.json.created})`);
    check(second.json.due === 2, `only the never-stampable templates remain due (due=${second.json.due})`);
    const stillOne = await db.select({ id: transactions.id }).from(transactions).where(inArray(transactions.id, [stampedId, genericId]));
    check(stillOne.length === 2, "exactly one row per (template, month) survives the re-run");

    // --- Credentials and input -------------------------------------------
    console.log("\nCredentials and input");
    const unauthorized = await callCron(date, null);
    check(unauthorized.status === 401, `no credential → 401 (got ${unauthorized.status})`);
    const wrong = await callCron(date, "Bearer zz-not-the-secret");
    check(wrong.status === 401, `a wrong credential → 401 (got ${wrong.status})`);
    const after401 = await db.select({ id: transactions.id }).from(transactions).where(inArray(transactions.id, [stampedId, genericId]));
    check(after401.length === 2, "and neither changed the ledger");

    for (const bad of ["2026-02-30", "2026-13-01", "not-a-date", "2026-6-1"]) {
      const response = await callCron(bad);
      check(response.status === 400, `\`date=${bad}\` → 400 (got ${response.status})`);
    }
  } finally {
    // --- Cleanup: exactly what we created --------------------------------
    console.log("\nCleanup");
    try {
      await db.delete(transactions).where(inArray(transactions.id, [stampedId, genericId].filter(Boolean)));
      await db.delete(templates).where(inArray(templates.id, fixtureIds));
      const leftoverTx = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(inArray(transactions.id, [stampedId, genericId].filter(Boolean)));
      const leftoverTemplates = await db.select({ id: templates.id }).from(templates).where(inArray(templates.id, fixtureIds));
      check(leftoverTx.length === 0, "0 fixture transactions left behind");
      check(leftoverTemplates.length === 0, "0 fixture templates left behind");

      // The route's housekeeping UPDATE is not scoped to the fixtures, so put
      // back any real template it cleared, then verify every one is unchanged.
      let restored = 0;
      for (const row of snapshot) {
        const current = await templateById(row.id);
        if (!current) continue;
        if (current.lastAutoKey !== row.lastAutoKey || current.skipMonth !== row.skipMonth) {
          await db
            .update(templates)
            .set({ lastAutoKey: row.lastAutoKey, skipMonth: row.skipMonth })
            .where(eq(templates.id, row.id));
          restored += 1;
        }
      }
      const mismatched: string[] = [];
      for (const row of snapshot) {
        const current = await templateById(row.id);
        if (!current) continue;
        if (current.lastAutoKey !== row.lastAutoKey || current.skipMonth !== row.skipMonth) mismatched.push(current.id);
      }
      check(mismatched.length === 0, `every pre-existing template matches its snapshot (restored ${restored})`);
      if (restored > 0) {
        console.log(
          `  ⓘ the housekeeping UPDATE cleared a stale marker on ${restored} real template(s) with no auto_day; restored`,
        );
      }
    } finally {
      process.env.CRON_SECRET = originalSecret;
    }
  }

  if (failures > 0) {
    console.error(`\n✗ Recurring cron FAILED (${failures} check(s) failed)`);
    process.exitCode = 1;
  } else {
    console.log("\n✓ Recurring cron OK — one stamp per (template, month), markers advanced, skips consumed, nothing real touched.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
