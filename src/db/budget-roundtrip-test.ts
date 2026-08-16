/**
 * Budget round-trip test — `npm run test:budget-roundtrip`.
 *
 * Regression test for the neon-http "no transactions" bug: saveBudgets and
 * setTotalBudget used `db.transaction(...)`, which drizzle's neon-http driver
 * does not support — every budget save threw at runtime and nothing ever
 * persisted. The actions now run plain delete-then-insert statements
 * (src/db/budget-mutations.ts); this test drives the exact mutation +
 * validation the actions perform against the real database and asserts the
 * rows persist and replace correctly, then cleans up in `finally`.
 *
 * The test writes to throwaway months ('2099-*') so it can never collide with
 * real budgets, and snapshot-restores the every-month default scope. Requires
 * a seeded database (`npm run db:seed`) and `.env.local`.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { eq, sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { replaceBudgetScope, replaceTotalBudgetRow } from "./budget-mutations";
import { budgets, categories } from "./schema";
import { saveBudgetsSchema, setTotalBudgetSchema } from "../lib/validations";
import { rupeesToPaise } from "../lib/money";

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

async function main() {
  // Throwaway months — far in the future, so they never collide with real budgets.
  const month = "2099-01";
  const defaultScopeMonth = "2099-02";

  const cat = (await db.select().from(categories).limit(1))[0];
  if (!cat) throw new Error("no categories — run npm run db:seed");
  const catId = cat.id;
  const otherCat = (await db.select().from(categories).limit(2))[1] ?? cat;

  // Snapshot the real every-month default scope so we can restore it exactly.
  const beforeDefault = await db.select().from(budgets).where(sql`${budgets.month} IS NULL`);

  try {
    // 1. saveBudgets for a concrete month: total + one category limit; the
    //    zero-paise category must not be stored.
    const first = saveBudgetsSchema.safeParse({
      month,
      totalPaise: 5_000_000, // ₹50,000
      categories: [
        { categoryId: catId, paise: 2_000_000 }, // ₹20,000
        { categoryId: otherCat.id, paise: 0 }, // no limit → not stored
      ],
    });
    check(first.success, "saveBudgetsSchema accepts the payload");
    if (!first.success) throw new Error("first payload rejected by the schema");
    await replaceBudgetScope(db, first.data.month, first.data.totalPaise ?? 0, first.data.categories);

    let rows = await db.select().from(budgets).where(eq(budgets.month, month));
    check(rows.length === 2, `total + one category limit persisted (${rows.length} rows, not 3)`);
    check(
      rows.some((r) => r.categoryId === null && rupeesToPaise(r.amount) === 5_000_000),
      "total row persisted at ₹50,000",
    );
    check(
      rows.some((r) => r.categoryId === catId && rupeesToPaise(r.amount) === 2_000_000),
      "category limit persisted at ₹20,000",
    );

    // 2. Re-saving replaces the scope — no duplicates, old rows gone.
    const second = saveBudgetsSchema.safeParse({
      month,
      totalPaise: 6_000_000, // ₹60,000 — changed
      categories: [{ categoryId: catId, paise: 2_500_000 }], // changed, other category dropped
    });
    if (!second.success) throw new Error("second payload rejected by the schema");
    await replaceBudgetScope(db, second.data.month, second.data.totalPaise ?? 0, second.data.categories);

    rows = await db.select().from(budgets).where(eq(budgets.month, month));
    check(rows.length === 2, "re-save replaced the scope (2 rows, no duplicates)");
    check(rows.some((r) => r.categoryId === null && rupeesToPaise(r.amount) === 6_000_000), "total updated to ₹60,000");
    check(!rows.some((r) => r.categoryId === otherCat.id), "dropped category limit is gone");

    // 3. Inline edit (setTotalBudget): touches only the total row.
    const edit = setTotalBudgetSchema.safeParse({ month, totalPaise: 7_000_000 });
    if (!edit.success) throw new Error("edit payload rejected by the schema");
    await replaceTotalBudgetRow(db, edit.data.month, edit.data.totalPaise);
    rows = await db.select().from(budgets).where(eq(budgets.month, month));
    check(rows.some((r) => r.categoryId === null && rupeesToPaise(r.amount) === 7_000_000), "inline edit updated the total");
    check(rows.some((r) => r.categoryId === catId && rupeesToPaise(r.amount) === 2_500_000), "category limit untouched by inline edit");

    // 4. Inline clear: total row removed, category rows remain.
    await replaceTotalBudgetRow(db, month, null);
    rows = await db.select().from(budgets).where(eq(budgets.month, month));
    check(!rows.some((r) => r.categoryId === null), "clear removed the total row");
    check(rows.length === 1 && rows[0].categoryId === catId, "category limit survives the clear");

    // 5. Every-month default scope (month = null) persists too.
    await replaceBudgetScope(db, null, 8_000_000, []);
    const defaults = await db.select().from(budgets).where(sql`${budgets.month} IS NULL`);
    check(
      defaults.some((r) => r.categoryId === null && rupeesToPaise(r.amount) === 8_000_000),
      "default scope (month NULL) total persisted at ₹80,000",
    );
  } finally {
    // Cleanup — always run, even when an assertion above failed.
    await db.delete(budgets).where(eq(budgets.month, month));
    await db.delete(budgets).where(eq(budgets.month, defaultScopeMonth));
    // Restore the real every-month default scope exactly as it was.
    await db.delete(budgets).where(sql`${budgets.month} IS NULL`);
    if (beforeDefault.length > 0) await db.insert(budgets).values(beforeDefault);
    const restored = await db.select().from(budgets).where(sql`${budgets.month} IS NULL`);
    if (restored.length === beforeDefault.length) {
      console.log(`  ✓ default scope restored (${restored.length} row(s))`);
    } else {
      failures += 1;
      console.error("  ✗ REVERT FAILED — the default budget may be changed; re-check Settings");
    }
  }

  if (failures > 0) {
    console.error(`✗ Budget round-trip FAILED (${failures} check(s) failed)`);
    process.exitCode = 1;
  } else {
    console.log("✓ Budget round-trip OK — scope replace + inline edit/clear persist on the neon-http driver.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
