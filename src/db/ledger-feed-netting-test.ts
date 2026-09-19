/**
 * Ledger-feed netting against a **real database** — `npm run test:ledger-feed-netting`.
 *
 * `src/lib/ledger-feed-test.ts` covers the netting as a pure function. This
 * covers what only a database can: that the real `getLedgerFeed` feeds that walk
 * the right rows, in the right order, selected on `created_at` — and that the two
 * D6 defects fixed on 19 September 2026 cannot come back through the SQL.
 *
 * It lives behind a database because the logic does: the netting is assembled
 * from `activity_log` in `src/lib/ledger-feed.ts`, which is `server-only`, which
 * is precisely why both defects survived a green pure suite on 18 September.
 *
 * `--conditions=react-server` is what makes the import legal. `server-only`
 * resolves to an empty module under the React Server Components condition and to
 * a throwing one otherwise, and a Node test process is not a bundler — so the
 * condition is passed explicitly by the npm script. It changes nothing else.
 *
 * The scenarios, one assertion cluster each:
 *
 *   - a delete + Undo inside the window reports NEITHER (D6, E4);
 *   - a row whose `created_at` the restore preserved stays OUT of Added, while
 *     an identical row stamped `now()` is IN it — the first 19 September defect,
 *     at the level where the feed actually decides;
 *   - a restore followed by a re-delete still reports the deletion — the second
 *     defect, the one a `Set`-difference netting swallowed;
 *   - a legacy restore payload (no `ids`, only `from`) nets out too;
 *   - a restore naming a row this window never deleted cancels nothing (E5).
 *
 * Writes only rows it creates, all marked `zzfnettest`, and deletes them in
 * `finally`. Requires a seeded database (`npm run db:seed`) and `.env.local`.
 */
import "./load-env";
import { assertNotProductionDb } from "./test-db-guard";

assertNotProductionDb("ledger-feed-netting-test");

import { inArray, like } from "drizzle-orm";
import { db } from "@/db";
import { feedWindowForInstant, getLedgerFeed } from "@/lib/ledger-feed";
import { activityLog, members, transactions } from "./schema";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

const MARKER = "zzfnettest";

/**
 * A business date far in the future, so a leaked fixture is obvious rather than
 * plausible. Deliberately unrelated to the window: this suite asserts the feed
 * selects on `created_at`, never on the business date (D2).
 */
const BUSINESS_DATE = "2099-01-02";

/** The whole row, as a delete writes it into `activity_log.payload`. */
function snapshotOf(row: typeof transactions.$inferSelect) {
  return {
    id: row.id,
    memberId: row.memberId,
    categoryId: row.categoryId,
    tag: row.tag,
    amount: row.amount,
    note: row.note,
    date: row.date,
    time: row.time,
    shared: row.shared,
    splitWith: row.splitWith,
    // `jsonb` round-trips these as ISO strings, which is why the real restore
    // path has to re-parse rather than being handed a Date.
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
  };
}

async function main() {
  const [member] = await db.select().from(members).limit(1);
  if (!member) throw new Error("no members — run npm run db:seed");

  const window = feedWindowForInstant(new Date());
  const windowStart = Date.parse(window.startIso);
  const windowEnd = Date.parse(window.endIso);
  /**
   * The window is `[boundary - 24 h, boundary)` and `now` is always **at or
   * after** that boundary, so "inside the window" can never be "now" — the
   * fixtures are pinned just before the end instead.
   */
  const inside = () => new Date(windowEnd - 60_000);
  /** One second apart, because the walk depends on `created_at` ORDER and ties are undefined. */
  let activityClock = inside().getTime();
  const nextActivityAt = () => new Date((activityClock += 1_000));
  /** Comfortably before the window, i.e. what a faithful restore preserves. */
  const before = new Date(windowStart - 60_000);

  const txnIds: string[] = [];
  const activityIds: string[] = [];

  const insertTxn = async (createdAt: Date, amount: string) => {
    const [row] = await db
      .insert(transactions)
      .values({
        // No `defaultRandom()` on this table (§8.1) — the app always supplies the
        // id, so the fixture must too.
        id: crypto.randomUUID(),
        memberId: member.id,
        categoryId: null,
        tag: "one_time",
        amount,
        note: `${MARKER} probe`,
        date: BUSINESS_DATE,
        time: "12:00:00",
        createdAt,
      })
      .returning();
    txnIds.push(row.id);
    return row;
  };

  const insertActivity = async (action: string, payload: unknown) => {
    const [row] = await db
      .insert(activityLog)
      .values({ action, entityType: "transaction", payload: payload as never, createdAt: nextActivityAt() })
      .returning();
    activityIds.push(row.id);
    return row;
  };

  try {
    check(windowEnd - windowStart === 24 * 60 * 60 * 1000, "the window under test is a real 24-hour window");

    // ---------------------------------------------------------------- fixtures
    // Entered BEFORE the window — this is the row a faithful restore brings back.
    const faithful = await insertTxn(before, "1.00");
    // The same transaction as if the restore had let `defaultNow()` fire.
    const stamped = await insertTxn(inside(), "1.00");
    const reDelete = await insertTxn(before, "2.00");
    const legacy = await insertTxn(before, "3.00");

    // 1. delete + Undo, both inside the window (E4).
    await insertActivity("delete_transaction", { transactions: [snapshotOf(faithful)] });
    await insertActivity("restore_transactions", { from: "irrelevant", restored: 1, ids: [faithful.id] });

    // 2. Undo first, then delete again — the order a Set-difference netting loses.
    await insertActivity("restore_transactions", { from: "irrelevant", restored: 1, ids: [reDelete.id] });
    await insertActivity("delete_transaction", { transactions: [snapshotOf(reDelete)] });

    // 3. legacy payload: no `ids`, only the originating delete entry.
    const legacyDelete = await insertActivity("delete_transactions", {
      count: 1,
      transactions: [snapshotOf(legacy)],
    });
    await insertActivity("restore_transactions", { from: legacyDelete.id, restored: 1 });

    // 4. a restore for a row this window never deleted (E5).
    await insertActivity("restore_transactions", {
      from: "irrelevant",
      restored: 1,
      ids: ["00000000-0000-4000-8000-000000000000"],
    });

    // ------------------------------------------------------------------ assert
    const feed = await getLedgerFeed(window);
    const addedIds = feed.added.map((row) => row.id);
    const deletedIds = feed.deleted.map((row) => row.id);
    /** Scoped to this suite's rows: real household activity may share the window. */
    const probeDeletions = deletedIds.filter((id) => txnIds.includes(id));

    check(feed.window.key === window.key, `the feed resolved the window it was given (${window.key})`);

    check(
      !deletedIds.includes(faithful.id),
      "a delete with its Undo in the same window reports no deletion (D6 / E4)",
    );
    check(
      !addedIds.includes(faithful.id),
      "and no synthetic re-add — a preserved created_at keeps it out of Added",
    );
    check(
      addedIds.includes(stamped.id),
      "a row actually created in the window IS an addition — what defaultNow() on restore produced",
    );
    check(
      stamped.date === BUSINESS_DATE &&
        !(stamped.date >= window.startDateIst && stamped.date <= window.endDateIst),
      `membership follows created_at, not the business date (D2) — ${stamped.date} lies outside ${window.startDateIst}..${window.endDateIst}`,
    );

    check(
      probeDeletions.filter((id) => id === reDelete.id).length === 1,
      "a restore followed by a re-delete reports exactly ONE deletion",
    );
    check(
      probeDeletions.length === 1,
      `only the re-delete survives — a restore cancels one deletion, not every one (${probeDeletions.length} reported)`,
    );
    check(
      !addedIds.includes(reDelete.id),
      "and the re-delete is not reported as an addition as well",
    );
    check(!deletedIds.includes(legacy.id), "a legacy restore payload (no `ids`) still nets out via `from`");
    check(
      !deletedIds.includes("00000000-0000-4000-8000-000000000000"),
      "a restore naming an id this window never deleted cancels nothing (E5)",
    );
    check(
      feed.counts.deleted === feed.deleted.length && feed.counts.added === feed.added.length,
      "the reported counts match the reported sections (post-netting)",
    );
    check(
      !feed.empty,
      "the window is not empty — the additions above are genuinely visible to the message builder",
    );
  } finally {
    if (activityIds.length > 0) {
      await db.delete(activityLog).where(inArray(activityLog.id, activityIds));
    }
    if (txnIds.length > 0) {
      await db.delete(transactions).where(inArray(transactions.id, txnIds));
    }
  }

  // The `finally` above is the safety net for whichever database this runs
  // against — prove it removed the fixtures rather than trusting the DELETE. The
  // marker check is deliberately wider than "the ids I created": it also catches
  // debris from an earlier run that died before its own cleanup.
  const leftovers = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(like(transactions.note, `${MARKER}%`));
  check(
    leftovers.length === 0,
    `the finally-cleanup removed every fixture row (${leftovers.length} marker row(s) left behind)`,
  );

  if (failures > 0) {
    console.error(`✗ Ledger-feed netting test FAILED (${failures} check(s) failed)`);
    process.exit(1);
  }
  console.log("✓ Ledger-feed netting OK — the real getLedgerFeed nets deletions pairwise, on created_at.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
