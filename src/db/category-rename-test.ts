/**
 * Category-rename round-trip test — `npm run test:rename-roundtrip`.
 *
 * Proves the propagation invariant behind "rename a category → every
 * historical transaction shows the new name": transactions store only
 * categoryId, and the display name is always joined fresh from the
 * categories table. The test drives the exact mutation + validation the
 * `updateCategory` server action performs (renameCategory in
 * src/db/category-mutations.ts, which the action calls, plus the same
 * Zod schema), then asserts the join reflects the new name on every row.
 *
 * The revert runs in `finally`, so a failed assertion can never leave the
 * database renamed — which would otherwise break the seed round-trip.
 *
 * Requires a seeded database (`npm run db:seed`) and `.env.local`.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { count, desc, eq } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { updateCategorySchema } from "../lib/validations";
import { renameCategory } from "./category-mutations";
import { categories, transactions } from "./schema";

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
  // 1. The most-referenced category gives the strongest propagation assertion.
  const top = await db
    .select({ categoryId: transactions.categoryId, n: count() })
    .from(transactions)
    .groupBy(transactions.categoryId)
    .orderBy(desc(count()))
    .limit(1);
  if (top.length === 0) throw new Error("no transactions — run npm run db:seed");
  const catId = top[0].categoryId!;
  const expectedRows = Number(top[0].n);
  const cat = (await db.select().from(categories).where(eq(categories.id, catId)))[0];
  if (!cat) throw new Error("target category not found");

  const joinedNames = async () =>
    (
      await db
        .select({ name: categories.name })
        .from(transactions)
        .innerJoin(categories, eq(transactions.categoryId, categories.id))
        .where(eq(transactions.categoryId, catId))
    ).map((r) => r.name);

  // 2. Baseline: every joined row already shows the current name.
  const baseline = await joinedNames();
  check(baseline.length === expectedRows, `baseline: ${expectedRows} transactions reference "${cat.name}"`);
  check(baseline.every((n) => n === cat.name), "baseline: all joined names match");

  const testName = `Renamed ${Date.now()}`;
  try {
    // 3. Same validation + mutation the updateCategory action performs.
    const parsed = updateCategorySchema.safeParse({
      id: cat.id,
      name: testName,
      emoji: cat.emoji,
      sortOrder: cat.sortOrder,
    });
    check(parsed.success, "updateCategorySchema accepts the rename payload");
    if (!parsed.success) throw new Error("rename payload rejected by the schema");
    await renameCategory(db, parsed.data);

    // 4. Propagation: every historical transaction now joins the new name.
    const after = await joinedNames();
    check(after.length === expectedRows, `row count unchanged after rename (${after.length})`);
    check(after.every((n) => n === testName), "every historical transaction shows the new name");
    if (!after.every((n) => n === testName)) {
      const bad = after.filter((n) => n !== testName);
      throw new Error(`rename did not propagate to ${bad.length} row(s): ${bad.slice(0, 3).join(", ")}`);
    }
    console.log(`  ✓ renamed "${cat.name}" → "${testName}" across ${after.length} transactions`);
  } finally {
    // 5. Always revert, even when an assertion above failed.
    const revert = updateCategorySchema.safeParse({
      id: cat.id,
      name: cat.name,
      emoji: cat.emoji,
      sortOrder: cat.sortOrder,
    });
    if (revert.success) await renameCategory(db, revert.data);
    const restored = await joinedNames();
    const ok = restored.length === expectedRows && restored.every((n) => n === cat.name);
    if (ok) console.log(`  ✓ reverted → "${cat.name}" restored across ${restored.length} transactions`);
    else {
      failures += 1;
      console.error("  ✗ REVERT FAILED — the database may be left renamed; run npm run db:seed to restore");
    }
  }

  if (failures > 0) {
    console.error(`✗ Category-rename round-trip FAILED (${failures} check(s) failed)`);
    process.exitCode = 1;
  } else {
    console.log(
      `✓ Category-rename round-trip OK — rename propagated to ${expectedRows} historical transactions and reverted cleanly.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
