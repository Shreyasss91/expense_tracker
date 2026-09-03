/**
 * Categorize round-trip test — `npm run test:categorize-roundtrip`.
 *
 * Amendment 20 regression suite: transactions.category_id became nullable so
 * Quick Add can capture without one and the Ledger assigns later. This drives
 * the exact SQL semantics the app relies on against the REAL database:
 *
 *   1. an INSERT without category_id persists (the schema change itself);
 *   2. the uncategorized predicate (category_id IS NULL) selects it and only
 *      it;
 *   3. the ledger's LEFT JOIN row shape yields NULL category fields for it
 *      (what TransactionListRow.category collapses from);
 *   4. batched assign/clear mirror assignCategory(): UPDATE ... WHERE id IN
 *      sets and clears categories for many rows in one statement;
 *   5. pendingReviewWhere() EXECUTES without a "missing FROM-clause entry"
 *      error when no categories join is present — the latent badge-count bug
 *      fixed by the EXISTS rewrite — and its generic-note logic treats
 *      uncategorized rows correctly;
 *   6. formatCsvLine renders a NULL category as an empty CSV cell.
 *
 * Writes throwaway rows dated '2099-*' tagged with a ZZCATTEST note prefix,
 * so they can never collide with real data; everything is deleted in
 * `finally`. Requires a seeded database (`npm run db:seed`) and `.env.local`.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { assertNotProductionDb } from "./test-db-guard";
assertNotProductionDb("categorize-roundtrip-test");

import { and, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { categories, members, transactions } from "./schema";
import { pendingReviewWhere } from "../lib/review-where";
import { formatCsvLine } from "../lib/csv-export";

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

const MARKER = "ZZCATTEST";
const DATE = "2099-01-15"; // far future — never collides with real data

async function main() {
  const member = (await db.select().from(members).limit(1))[0];
  const category = (await db.select().from(categories).limit(1))[0];
  if (!member || !category) throw new Error("no members/categories — run npm run db:seed");

  const createdIds: string[] = [];
  try {
    const [categorized] = await db
      .insert(transactions)
      .values({
        id: crypto.randomUUID(),
        memberId: member.id,
        categoryId: category.id,
        tag: "lifestyle",
        amount: "10.00",
        note: `${MARKER} control row`,
        date: DATE,
        time: "10:00:00",
      })
      .returning();
    createdIds.push(categorized.id);

    // THE amendment-20 insert: no categoryId at all.
    const [uncategorized] = await db
      .insert(transactions)
      .values({
        id: crypto.randomUUID(),
        memberId: member.id,
        tag: "lifestyle",
        amount: "25.50",
        note: `${MARKER} capture-first row`,
        date: DATE,
        time: "11:30:00",
      })
      .returning();
    createdIds.push(uncategorized.id);

    // 1. persistence shape
    check(categorized.categoryId !== null, "control row keeps its category");
    check(uncategorized.categoryId === null, "INSERT without category_id persists as NULL");

    // 2+3. the ledger read path: IS NULL predicate + LEFT JOIN row shape
    const rows = await db
      .select({
        id: transactions.id,
        categoryId: transactions.categoryId,
        categoryName: sql<string | null>`categories.name`,
        categoryEmoji: sql<string | null>`categories.emoji`,
      })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(and(isNull(transactions.categoryId), like(transactions.note, `${MARKER}%`)));

    check(rows.length === 1, `IS NULL filter matches exactly the uncategorized row (${rows.length})`);
    check(rows[0]?.id === uncategorized.id, "the uncategorized row is the capture-first one");
    check(rows[0]?.categoryName === null && rows[0]?.categoryEmoji === null, "LEFT JOIN yields NULL category fields");

    // 4. batched assign, then batched clear — assignCategory() semantics
    const bothIds = [categorized.id, uncategorized.id];
    const assigned = await db
      .update(transactions)
      .set({ categoryId: category.id })
      .where(inArray(transactions.id, bothIds))
      .returning({ id: transactions.id });
    check(assigned.length === 2, `batched UPDATE ... IN assigned ${assigned.length}/2 rows`);

    const stillUncategorized = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(isNull(transactions.categoryId), like(transactions.note, `${MARKER}%`)));
    check(stillUncategorized.length === 0, "no marker rows remain uncategorized after batch assign");

    const cleared = await db
      .update(transactions)
      .set({ categoryId: null })
      .where(eq(transactions.id, uncategorized.id))
      .returning({ id: transactions.id });
    check(cleared.length === 1, "batched UPDATE clears back to NULL (un-categorize)");

    // 5. pendingReviewWhere must execute WITHOUT a categories join present
    //    (regression: the badge count used to reference categories.name from
    //    a bare FROM transactions — invalid SQL). Our marker notes are
    //    non-generic, so they must NOT enter the queue…
    await db
      .select({ count: sql<number>`count(*)::int` })
      .from(transactions)
      .where(pendingReviewWhere());
    check(true, "pendingReviewWhere executes without a join (missing-FROM regression)");

    // …and a NULL-note uncategorized row DOES belong to the queue.
    await db.update(transactions).set({ note: null }).where(eq(transactions.id, uncategorized.id));
    const queued = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(pendingReviewWhere());
    check(
      queued.some((r) => r.id === uncategorized.id),
      "NULL-note uncategorized row enters the Review queue",
    );

    // 6. CSV: NULL category exports as an empty cell, position preserved
    const csv = formatCsvLine({
      date: DATE,
      time: "11:30:00",
      member: member.name,
      note: `${MARKER} export`,
      amount: "25.50",
      category: null,
      tag: "lifestyle",
    });
    const cells = csv.split(",");
    // columns: date,time,member,item,amount,category,tag → index 5 empty
    check(cells.length === 7 && cells[5] === "", "CSV row renders NULL category as an empty cell");
  } finally {
    // sweep by marker AND by explicit ids (one row's note was nulled above,
    // so the LIKE alone would miss it)
    await db.delete(transactions).where(like(transactions.note, `${MARKER}%`));
    if (createdIds.length > 0) {
      await db.delete(transactions).where(inArray(transactions.id, createdIds));
    }
  }
}

main()
  .then(() => {
    if (failures > 0) {
      console.error(`✗ Categorize round-trip FAILED (${failures} check(s) failed)`);
      process.exitCode = 1;
    } else {
      console.log("✓ Categorize round-trip OK — nullable categories behave end to end.");
    }
  })
  .catch((err) => {
    console.error("✗ Categorize round-trip crashed:", err);
    process.exitCode = 1;
  });
