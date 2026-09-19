/**
 * Restore round-trip through the **transactions table** — `npm run test:restore-roundtrip`.
 *
 * `restoreValuesFromSnapshot` is unit-tested in `src/lib/ledger-feed-test.ts`,
 * but only as a pure function: it can show that the mapping *returns* the
 * original `created_at`. It cannot show that the row which reaches the database
 * actually carries it — and that is the half that decides the feed, because the
 * feed selects on `transactions.created_at`.
 *
 * So this drives the whole loop the way `deleteTransaction` and
 * `restoreActivityEntry` do it:
 *
 *   insert → read → snapshot through a `jsonb` round-trip → delete → map →
 *   insert → read back
 *
 * and asserts the timestamps survived. Two scenarios, because the interesting
 * thing is the *difference* between them:
 *
 *   1. a faithful snapshot restores the ORIGINAL `created_at` and `reviewed_at`;
 *   2. a snapshot with no usable timestamps falls back to the column defaults —
 *      `created_at` = now, `reviewed_at` = NULL (pending review).
 *
 * Scenario 2 is what makes scenario 1 worth asserting: without it, "the
 * timestamp was preserved" could pass vacuously in a world where nothing was
 * ever preserved. And scenario 1 is the fix — a row stamped `now()` on restore
 * lands in whichever feed window is open at the moment of the Undo, so undoing
 * the deletion of an old expense would announce it as a brand-new addition.
 *
 * `--conditions=react-server` is required for the same reason as
 * `ledger-feed-netting-test.ts`: both `getLedgerFeed` and the `db` singleton sit
 * behind `import "server-only"`. `./load-env` must stay the FIRST import, so
 * `DATABASE_URL` is set before `src/db/index.ts` builds its neon client.
 *
 * Writes only rows it creates, all marked `zzrestoretest`, and deletes them in
 * `finally`. Requires a seeded database (`npm run db:seed`) and `.env.local`.
 */
import "./load-env";
import { assertNotProductionDb } from "./test-db-guard";

assertNotProductionDb("restore-roundtrip-test");

import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/db";
import { feedWindowForInstant, getLedgerFeed } from "@/lib/ledger-feed";
import { restoreValuesFromSnapshot } from "@/lib/transaction-diff";
import { members, transactions } from "./schema";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

const MARKER = "zzrestoretest";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The delete payload exactly as `deleteTransaction` writes it: the whole
 * `.returning()` row, serialized. The JSON pass is not decoration — it is what
 * turns `created_at` from a `Date` into the ISO string the restore path has to
 * re-parse, so skipping it would test a shape the app never produces.
 */
const asDeletePayload = (row: typeof transactions.$inferSelect) =>
  JSON.parse(JSON.stringify(row)) as Record<string, unknown>;

async function main() {
  const [member] = await db.select().from(members).limit(1);
  if (!member) throw new Error("no members — run npm run db:seed");

  const window = feedWindowForInstant(new Date());
  const createdIds: string[] = [];

  /** Ten days back: outside every window the feed renders tonight, and provably not "now". */
  const originalCreatedAt = new Date(Date.now() - 10 * DAY_MS);
  const originalReviewedAt = new Date(Date.now() - 9 * DAY_MS);
  const businessDate = new Date(originalCreatedAt.getTime() - DAY_MS).toISOString().slice(0, 10);

  const roundTrip = async (note: string) => {
    const id = crypto.randomUUID();
    createdIds.push(id);
    await db.insert(transactions).values({
      id,
      memberId: member.id,
      categoryId: null,
      tag: "lifestyle",
      amount: "1234.56",
      note: `${MARKER} ${note}`,
      date: businessDate,
      time: "07:45:00",
      createdAt: originalCreatedAt,
      reviewedAt: originalReviewedAt,
      shared: true,
      splitWith: [member.id],
    });

    const [live] = await db.select().from(transactions).where(eq(transactions.id, id));
    const payload = asDeletePayload(live);

    // The real path hard-deletes first, then re-inserts from the snapshot.
    await db.delete(transactions).where(eq(transactions.id, id));
    const [gone] = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, id));
    return { id, payload, gone: gone === undefined };
  };

  try {
    // ------------------------------------------------ 1. a faithful restore
    const faithful = await roundTrip("faithful");
    check(faithful.gone, "the fixture was really deleted before the restore ran");
    check(
      typeof faithful.payload.createdAt === "string" && typeof faithful.payload.reviewedAt === "string",
      "a real delete payload carries both timestamps as ISO strings (the jsonb round-trip)",
    );

    const values = restoreValuesFromSnapshot(faithful.payload);
    if (!values) throw new Error("restoreValuesFromSnapshot refused a real delete payload");
    const [restored] = await db.insert(transactions).values(values).returning();

    check(restored.id === faithful.id, "the row comes back under its original id");
    check(
      restored.createdAt.toISOString() === originalCreatedAt.toISOString(),
      "created_at is the ORIGINAL instant, not the restore instant — the whole point of the mapping",
    );
    check(
      restored.reviewedAt?.toISOString() === originalReviewedAt.toISOString(),
      "reviewed_at is preserved too, so an acknowledged expense is not re-queued for review",
    );
    check(
      restored.amount === "1234.56" && restored.note === `${MARKER} faithful` && restored.tag === "lifestyle",
      "the editable columns round-trip (amount, note, tag)",
    );
    check(
      restored.date === businessDate && restored.time === "07:45:00",
      "the business date and time are the entered ones, untouched by the restore",
    );
    check(
      restored.categoryId === null && restored.shared === true && restored.splitWith.join() === member.id,
      "the uncategorized state and the assignment round-trip",
    );

    // The user-visible consequence. `created_at` is what the feed selects on, so
    // a preserved timestamp keeps an Undo out of tonight's message entirely.
    check(
      Date.parse(restored.createdAt.toISOString()) < Date.parse(window.startIso),
      `the restored row predates the window under test (${window.key})`,
    );
    const feed = await getLedgerFeed(window);
    check(
      !feed.added.some((row) => row.id === restored.id),
      "so undoing the deletion of an older expense is NOT announced as tonight's addition",
    );

    // --------------------------------- 2. the fallback: no usable timestamps
    const legacy = await roundTrip("legacy");
    // A payload written before the timestamps were carried — or with a corrupt
    // one — is modelled by simply removing the keys. (Deleting rather than
    // destructuring around them, so the lint gate stays at zero new warnings.)
    const timestampsDropped: Record<string, unknown> = { ...legacy.payload };
    delete timestampsDropped.createdAt;
    delete timestampsDropped.reviewedAt;
    const legacyValues = restoreValuesFromSnapshot(timestampsDropped);
    if (!legacyValues) throw new Error("restoreValuesFromSnapshot refused a snapshot without timestamps");
    const [legacyRestored] = await db.insert(transactions).values(legacyValues).returning();

    check(
      legacyValues.createdAt === undefined,
      "a snapshot with no created_at maps to `undefined`, so the column default applies",
    );
    check(
      Math.abs(Date.now() - legacyRestored.createdAt.getTime()) < 60_000,
      "and the row really is stamped now() — which is why scenario 1's assertion is not vacuous",
    );
    check(
      legacyRestored.reviewedAt === null,
      "a snapshot with no reviewed_at restores as pending review rather than guessing",
    );
  } finally {
    if (createdIds.length > 0) {
      await db.delete(transactions).where(inArray(transactions.id, createdIds));
    }
  }

  // Prove the cleanup instead of trusting it — same reasoning as the netting
  // suite: on a production-shaped database the `finally` is the only guard.
  const leftovers = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(like(transactions.note, `${MARKER}%`));
  check(
    leftovers.length === 0,
    `the finally-cleanup removed every fixture row (${leftovers.length} marker row(s) left behind)`,
  );

  if (failures > 0) {
    console.error(`✗ Restore round-trip test FAILED (${failures} check(s) failed)`);
    process.exit(1);
  }
  console.log("✓ Restore round-trip OK — a restore is faithful, timestamps included.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
