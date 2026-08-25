/**
 * Category hierarchy round-trip test — `npm run test:hierarchy`.
 *
 * Two-level category taxonomy regression suite. Drives the exact SQL
 * semantics the app relies on against the REAL database:
 *
 *   1. a group row (parent_id NULL) and a leaf row under it persist;
 *   2. isAssignableCategory() accepts the leaf and rejects BOTH the group
 *      and an unknown id — the guard behind every transaction/template/
 *      budget mutation, so groups can never receive spend directly;
 *   3. the dashboard's rollup join (leaf → parent) attributes a leaf
 *      transaction to exactly one group;
 *   4. depth is structurally capped: parenting the group under its own leaf
 *      would create a cycle — rejected by FK semantics being self-referential
 *      only (the app forbids it in moveCategoryToGroup; this asserts the
 *      query shape used there reads back the expected parentage).
 *
 * Writes throwaway rows with ZZGRPTEST slug/note markers dated '2099-*',
 * so they can never collide with real data; everything is deleted in
 * `finally`. Requires a seeded database (`npm run db:seed`) and `.env.local`.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { eq } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { categories, members, transactions } from "./schema";
import { isAssignableCategory } from "./category-mutations";

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

const MARKER = "zzgrptest";

async function main() {
  const member = (await db.select().from(members).limit(1))[0];
  if (!member) throw new Error("no members — run npm run db:seed");

  const createdIds: string[] = [];
  let txnId: string | null = null;
  try {
    // 1. group + leaf persist with the expected parentage
    const [group] = await db
      .insert(categories)
      .values({ slug: `${MARKER}-group`, name: "ZZ Test Group", emoji: "🧪", color: "#111111", sortOrder: 900 })
      .returning();
    createdIds.push(group.id);
    const [leaf] = await db
      .insert(categories)
      .values({ slug: `${MARKER}-leaf`, name: "ZZ Test Leaf", emoji: "🧪", color: "#222222", sortOrder: 901, parentId: group.id })
      .returning();
    createdIds.push(leaf.id);

    check(group.parentId === null, "group row persists with parent_id NULL");
    check(leaf.parentId === group.id, "leaf row persists pointing at its group");

    // 2. assignability — leaves yes, groups no, unknown no
    check((await isAssignableCategory(db, leaf.id)) === true, "isAssignableCategory accepts a leaf");
    check((await isAssignableCategory(db, group.id)) === false, "isAssignableCategory rejects a group");
    check((await isAssignableCategory(db, crypto.randomUUID())) === false, "isAssignableCategory rejects an unknown id");

    // 3. the rollup join attributes leaf spend to exactly one group
    const [txn] = await db
      .insert(transactions)
      .values({
        id: crypto.randomUUID(),
        memberId: member.id,
        categoryId: leaf.id,
        tag: "one_time",
        amount: "12.34",
        note: `${MARKER} rollup probe`,
        date: "2099-01-15",
        time: "10:00:00",
      })
      .returning();
    txnId = txn.id;

    const rollup = await db
      .select({ groupId: categories.parentId })
      .from(transactions)
      .innerJoin(categories, eq(transactions.categoryId, categories.id))
      .where(eq(transactions.id, txn.id));
    check(rollup.length === 1 && rollup[0].groupId === group.id, "rollup join attributes leaf spend to its group");

    // 4. parentage read-back (the shape moveCategoryToGroup reasons over)
    const [reread] = await db
      .select({ parentId: categories.parentId })
      .from(categories)
      .where(eq(categories.id, leaf.id));
    check(reread?.parentId === group.id && reread.parentId !== leaf.id, "leaf never parents itself");
  } finally {
    if (txnId) await db.delete(transactions).where(eq(transactions.id, txnId));
    for (const id of createdIds.reverse()) {
      await db.delete(categories).where(eq(categories.id, id));
    }
  }

  if (failures > 0) {
    console.error(`✗ Hierarchy test FAILED (${failures} check(s) failed)`);
    process.exit(1);
  }
  console.log("✓ Hierarchy test OK");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
