/**
 * Budget semantics test — `npm run test:budget-semantics`.
 *
 * Phase-2 hardening (F2-04 / F2-06): the round-trip test proves budget rows
 * *persist*; this test proves the budget *mathematics* against the real
 * database, using the exact production helpers (getMonthBudgetStatus,
 * getBudgetAlert) and the exact dashboard bills aggregate:
 *
 *   - exclude-bills OFF  → total budget compares ALL spend
 *   - exclude-bills ON   → total budget compares spend − recurring bills
 *   - category budgets   → always count everything (never exclude bills)
 *   - exact-month budget → beats the every-month default (and falls back to it)
 *   - total alert wins over the category alert when both are over
 *   - the "It's a bill" chain: recurring tag → DB row → over-budget alert
 *     classification → dashboard Bills aggregate
 *
 * Scenario (per the Phase-2 audit): Expense A ₹1,000 lifestyle + Expense B
 * ₹2,000 recurring in the same category; total budget ₹2,500; category budget
 * ₹2,400. exclude OFF → spent ₹3,000 (over ₹500); exclude ON → spent ₹1,000
 * (left ₹1,500); category still counts ₹3,000 (over ₹600).
 *
 * Writes to throwaway months ('2099-*') only, and snapshot-restores the real
 * every-month budgets, the real exclude-bills setting, and deletes the
 * throwaway transactions in `finally`. Requires a seeded database
 * (`npm run db:seed`) and `.env.local` with migration 0002 applied.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { budgetsForMonth, getBudgetAlert, getMonthBudgetStatus, resolveEffectiveBudget } from "../lib/budgets";
import { EXCLUDE_BILLS_KEY, getAppSetting, setAppSetting } from "./app-settings-mutations";
import { replaceBudgetScope } from "./budget-mutations";
import { appSettings, budgets, categories, members, transactions } from "./schema";
import { transactionSchema } from "../lib/validations";
import { paiseToDbString, rupeesToPaise } from "../lib/money";

const client = neon(process.env.DATABASE_URL ?? "");
const db = drizzle({ client });

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

function monthEnd(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${monthKey}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

async function main() {
  const month = "2099-03";
  const emptyMonth = "2099-04"; // transactions but NO budget — helpers must return null

  const member = (await db.select().from(members).limit(1))[0];
  if (!member) throw new Error("no members — run npm run db:seed");
  const cat = (await db.select().from(categories).limit(1))[0];
  if (!cat) throw new Error("no categories — run npm run db:seed");
  const catId = cat.id;

  // Snapshot the real state so cleanup can restore it exactly.
  const beforeDefault = await db.select().from(budgets).where(sql`${budgets.month} IS NULL`);
  const beforeExcludeBills = await getAppSetting(db, EXCLUDE_BILLS_KEY);

  const txnIds = [randomUUID(), randomUUID(), randomUUID()];
  const insertValues = [
    { id: txnIds[0], memberId: member.id, categoryId: catId, type: "expense" as const, tag: "lifestyle" as const, amount: paiseToDbString(100_000), note: "Semantics A", date: `${month}-10`, time: "10:00:00" },
    { id: txnIds[1], memberId: member.id, categoryId: catId, type: "expense" as const, tag: "recurring" as const, amount: paiseToDbString(200_000), note: "Semantics B — the bill", date: `${month}-12`, time: "10:00:00" },
    { id: txnIds[2], memberId: member.id, categoryId: catId, type: "expense" as const, tag: "one_time" as const, amount: paiseToDbString(50_000), note: "Semantics C", date: `${emptyMonth}-05`, time: "10:00:00" },
  ];

  try {
    // The real DB may already have an every-month default budget — clear the
    // NULL-month rows for the duration of the test so the "no budget" checks
    // see a clean world; `finally` restores the snapshot exactly.
    await db.delete(budgets).where(sql`${budgets.month} IS NULL`);

    // --- F2-06 start of the chain: the "It's a bill" payload is accepted by
    // the same discriminated-union schema the Quick Add submit sends.
    const billPayload = {
      memberId: member.id,
      categoryId: catId,
      amount: 200_000,
      note: "Semantics B",
      date: `${month}-12`,
      time: "10:00",
      type: "expense" as const,
      tag: "recurring" as const,
    };
    const billParsed = transactionSchema.safeParse(billPayload);
    check(billParsed.success && billParsed.data.tag === "recurring", "bill-shortcut payload ('recurring') passes the transaction schema");
    const incomeParsed = transactionSchema.safeParse({ ...billPayload, type: "income" as const, tag: undefined });
    check(incomeParsed.success && incomeParsed.data.tag === undefined, "income payload with no tag still passes (tag invariant intact)");

    await db.insert(transactions).values(insertValues);
    const stored = await db.select().from(transactions).where(eq(transactions.id, txnIds[1]));
    check(stored[0]?.tag === "recurring", "the recurring-tagged row lands in the DB with tag='recurring'");

    // Budgets: exact-month total ₹2,500 + exact-month category X limit ₹2,400.
    await replaceBudgetScope(db, month, 250_000, [{ categoryId: catId, paise: 240_000 }]);
    await setAppSetting(db, EXCLUDE_BILLS_KEY, "0");

    // --- F2-04: exclude OFF — total budget counts ALL spend.
    const off = await getMonthBudgetStatus(db, month);
    check(off?.budgetPaise === 250_000, "total budget resolves to ₹2,500");
    check(off?.spentPaise === 300_000, "exclude OFF: spent = all spend = ₹3,000");
    check(off?.billsPaise === 200_000, "bills portion detected as ₹2,000");
    check(off?.excludeBills === false, "exclude flag reads OFF");

    const offAlert = await getBudgetAlert(db, month, catId);
    check(offAlert?.kind === "total" && offAlert?.overPaise === 50_000, "exclude OFF: total alert ₹500 over (total wins over category)");

    // --- F2-04: exclude ON — total budget counts spend − bills; category
    // budget still counts everything.
    await setAppSetting(db, EXCLUDE_BILLS_KEY, "1");
    const on = await getMonthBudgetStatus(db, month);
    check(on?.spentPaise === 100_000, "exclude ON: spent = expense − bills = ₹1,000");
    check(on?.excludeBills === true, "exclude flag reads ON");

    const onAlert = await getBudgetAlert(db, month, catId);
    check(onAlert === null || onAlert.kind !== "total", "exclude ON: total is NOT over (₹1,000 < ₹2,500)");
    check(onAlert?.kind === "category" && onAlert?.overPaise === 60_000, "exclude ON: category alert fires — ₹600 over, bills still counted");

    // --- No budget at all → helpers return null / no alert. Runs BEFORE any
    // every-month default is created, so the default cannot leak into this month.
    const nullStatus = await getMonthBudgetStatus(db, emptyMonth);
    check(nullStatus === null, "no total budget → getMonthBudgetStatus returns null");
    const nullAlert = await getBudgetAlert(db, emptyMonth, catId);
    check(nullAlert === null, "no budgets at all → getBudgetAlert returns null");

    // --- F2-04: exact month beats the default, and falls back to it.
    await replaceBudgetScope(db, null, 200_000, []);
    const withExact = await getMonthBudgetStatus(db, month);
    check(withExact?.budgetPaise === 250_000, "exact-month budget (₹2,500) beats the default (₹2,000)");

    // resolveEffectiveBudget precedence — while the exact-month total still exists.
    const rows = await budgetsForMonth(db, month);
    check(
      resolveEffectiveBudget(rows, month, null)?.month === month,
      "resolveEffectiveBudget prefers the exact-month total row",
    );

    await db.delete(budgets).where(and(eq(budgets.month, month), sql`${budgets.categoryId} IS NULL`));
    const afterExactRemoved = await getMonthBudgetStatus(db, month);
    check(afterExactRemoved?.budgetPaise === 200_000, "default budget (₹2,000) applies once the exact-month total is gone");

    // --- F2-06 end of the chain: the dashboard Bills aggregate includes the
    // recurring row (same SQL the Overview bills card runs).
    const agg = await db
      .select({
        bills: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.type} = 'expense' AND ${transactions.tag} = 'recurring'), 0)`,
      })
      .from(transactions)
      .where(and(gte(transactions.date, `${month}-01`), lte(transactions.date, monthEnd(month))));
    check(rupeesToPaise(agg[0].bills) === 200_000, "dashboard Bills aggregate includes the recurring row (₹2,000)");
  } finally {
    // Cleanup — always run, even when an assertion above failed.
    await db.delete(transactions).where(inArray(transactions.id, txnIds));
    await db.delete(budgets).where(eq(budgets.month, month));
    await db.delete(budgets).where(eq(budgets.month, emptyMonth));
    await db.delete(budgets).where(sql`${budgets.month} IS NULL`);
    if (beforeDefault.length > 0) await db.insert(budgets).values(beforeDefault);
    // Restore the real exclude-bills setting exactly as it was.
    if (beforeExcludeBills === null) {
      await db.delete(appSettings).where(eq(appSettings.key, EXCLUDE_BILLS_KEY));
      console.log("  ✓ exclude-bills setting restored (had no prior value)");
    } else {
      await setAppSetting(db, EXCLUDE_BILLS_KEY, beforeExcludeBills);
      console.log("  ✓ exclude-bills setting restored to its prior value");
    }
  }

  if (failures > 0) {
    console.error(`✗ Budget semantics FAILED (${failures} check(s) failed)`);
    process.exitCode = 1;
  } else {
    console.log("✓ Budget semantics OK — exclude-bills math, precedence and the bill chain verified against the DB.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
