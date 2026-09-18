/**
 * Ledger-change feed tests — `npm run test:ledger-feed`.
 *
 * DB-free on purpose: the window arithmetic, the snapshot diff and the message
 * format are pure, and they are where the subtle bugs live. The DB-backed
 * aggregation in ledger-feed.ts (including delete/restore netting) is exercised
 * by `/api/digest/day` against real data — see the spec's §8 manual commands.
 */
import {
  buildFeedChanges,
  buildLedgerFeedMessage,
  categoryLabel,
  sanitizeWhatsAppText,
  UNCATEGORIZED_LABEL,
  type LedgerFeed,
} from "./ledger-feed-format";
import {
  FEED_GRACE_MS,
  FEED_KEY_RE,
  feedKeyHasEnded,
  feedWindowForInstant,
  parseFeedKey,
  windowKeyLabel,
} from "./ledger-feed-window";
import { diffSnapshots, toSnapshot, type TransactionSnapshot } from "./transaction-diff";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

/* ------------------------------------------------------------ window math ---- */

console.log("\nWindow math");

// 2026-09-18 22:00 IST === 16:30 UTC (IST is a fixed +05:30, no DST).
const boundary = new Date("2026-09-18T16:30:00.000Z");

const onBoundary = feedWindowForInstant(boundary);
check(onBoundary.endIso === boundary.toISOString(), "on the boundary: the window ENDS now");
check(onBoundary.startIso === "2026-09-17T16:30:00.000Z", "on the boundary: start is exactly 24 h earlier");
check(onBoundary.key === "2026-09-17..2026-09-18", "on the boundary: key is the two IST dates");
check(onBoundary.startIst === "2026-09-17 22:00" && onBoundary.endIst === "2026-09-18 22:00", "on the boundary: IST stamps render 22:00");
check(onBoundary.stale === false, "on the boundary: not stale");

const oneSecondBefore = feedWindowForInstant(new Date("2026-09-18T16:29:59.000Z"));
check(oneSecondBefore.key === "2026-09-16..2026-09-17", "one second before: resolves to the PREVIOUS window");
check(oneSecondBefore.endIso === "2026-09-17T16:30:00.000Z", "one second before: ends yesterday 22:00 IST");
check(oneSecondBefore.stale === true, "one second before: yesterday's window is already stale");

const lateFire = feedWindowForInstant(new Date("2026-09-18T16:37:00.000Z")); // 22:07 IST
check(lateFire.key === onBoundary.key, "a late fire (22:07) resolves the SAME key as an on-time one");
check(lateFire.endIso === onBoundary.endIso, "a late fire keeps the canonical boundary, not the wall clock");

const monthRollover = feedWindowForInstant(new Date("2026-10-02T16:30:00.000Z"));
check(monthRollover.key === "2026-10-01..2026-10-02", "month rollover keeps both IST dates");
const yearRollover = feedWindowForInstant(new Date("2027-01-01T16:30:00.000Z"));
check(yearRollover.key === "2026-12-31..2027-01-01", "year rollover keeps both IST dates");

/* --------------------------------------------------- window key validation ---- */

console.log("\nWindow key validation (POST /api/digest/day)");

// A key the endpoint hands out must parse back to the window it came from.
const roundTrip = parseFeedKey(onBoundary.key);
check(roundTrip !== null, "a key the endpoint issues parses back");
if (roundTrip) {
  check(
    roundTrip.startIso === onBoundary.startIso && roundTrip.endIso === onBoundary.endIso,
    "…to the same 22:00 IST boundaries",
  );
  check(roundTrip.label === onBoundary.label, "…and the same human label");

  const endsAt = new Date(roundTrip.endIso);
  check(feedKeyHasEnded(roundTrip, endsAt), "a window ending exactly now counts as ended");
  check(!feedKeyHasEnded(roundTrip, new Date(endsAt.getTime() - 1_000)), "one second before its end it has NOT ended");
  check(feedKeyHasEnded(roundTrip, new Date(endsAt.getTime() + 1_000)), "one second after its end it has");
}
check(parseFeedKey(yearRollover.key) !== null, "a year-rollover key parses (adjacent across the new year)");

// The shape regex alone is the reason `parseFeedKey` exists: every key below
// passed it, and each would have been written verbatim as a permanent marker.
check(
  FEED_KEY_RE.test("9999-99-99..9999-99-99"),
  "the SHAPE regex alone accepts 9999-99-99 — which is why shape is not enough",
);
check(parseFeedKey("9999-99-99..9999-99-99") === null, "an impossible month/day is rejected");
check(parseFeedKey("2026-02-30..2026-03-01") === null, "February 30 is rejected rather than rolled over");
check(parseFeedKey("2027-02-29..2027-03-01") === null, "a non-leap February 29 is rejected");
check(parseFeedKey("2028-02-28..2028-02-29") !== null, "a real leap day parses");
check(parseFeedKey("2026-01-01..2026-12-31") === null, "a NON-ADJACENT range is rejected — the key means 24 hours");
check(parseFeedKey("2026-09-18..2026-09-17") === null, "a reversed range is rejected");
check(parseFeedKey("2026-09-17") === null, "a bare date is rejected");
check(parseFeedKey("not-a-key") === null, "garbage is rejected");
check(parseFeedKey("") === null, "an empty key is rejected");

check(
  feedWindowForInstant(new Date(boundary.getTime() + FEED_GRACE_MS)).stale === false,
  "stale flips only PAST the grace period (exactly 6 h is still fresh)",
);
check(
  feedWindowForInstant(new Date(boundary.getTime() + FEED_GRACE_MS + 1000)).stale === true,
  "stale is true one second past the grace period",
);

check(
  windowKeyLabel("2026-09-17..2026-09-18") === "Thu 17 Sep 22:00 → Fri 18 Sep 22:00",
  "windowKeyLabel reconstructs the header label from the key",
);
check(windowKeyLabel("garbage") === "garbage", "an unparseable key falls back to itself");

/* --------------------------------------------------------------- diffing ---- */

console.log("\nSnapshot diffing");

const base: TransactionSnapshot = {
  memberId: "m-dad",
  categoryId: "c-fuel",
  tag: "one_time",
  amount: "450.00",
  note: "Petrol at Shell",
  date: "2026-09-17",
  time: "09:14:00",
  splitWith: [],
};

check(diffSnapshots(base, { ...base }).length === 0, "identical snapshots produce no change");
check(diffSnapshots(null, base).length === 0, "a null pre-image produces no change (and does not throw)");
check(diffSnapshots(base, { ...base, amount: "500.00" }).join() === "amount", "amount change is detected alone");
check(diffSnapshots(base, { ...base, amount: "450.0" }).length === 0, "\"450.00\" → \"450.0\" is NOT a change");
check(diffSnapshots(base, { ...base, note: null }).join() === "note", "note cleared is detected");
check(diffSnapshots(base, { ...base, categoryId: null }).join() === "categoryId", "category cleared is detected");
check(diffSnapshots(base, { ...base, tag: "recurring" }).join() === "tag", "tag change is detected");
check(diffSnapshots(base, { ...base, date: "2026-09-18" }).join() === "date", "date change is detected");
check(diffSnapshots(base, { ...base, time: "10:00:00" }).join() === "time", "time change is detected");
check(diffSnapshots(base, { ...base, memberId: "m-mom" }).join() === "memberId", "member change is detected");
check(
  diffSnapshots(base, { ...base, splitWith: ["m-mom", "m-dad"] }).join() === "splitWith",
  "assignment change is detected",
);
check(
  diffSnapshots(base, { ...base, splitWith: [...base.splitWith] }).length === 0,
  "an identical assignment is not a change",
);
check(
  diffSnapshots({ ...base, splitWith: ["m-dad", "m-mom"] }, { ...base, splitWith: ["m-mom", "m-dad"] }).length === 0,
  "assignment is a set: reordering the ids is not a change",
);

const rowSnapshot = toSnapshot({
  memberId: "m-dad",
  categoryId: null,
  tag: "lifestyle",
  amount: "120.00",
  note: null,
  date: "2026-09-18",
  time: "21:40:00",
  splitWith: null,
});
check(rowSnapshot.categoryId === null && rowSnapshot.note === null, "toSnapshot normalizes nulls");
check(rowSnapshot.splitWith.length === 0, "toSnapshot normalizes a null assignment to []");

/* ---------------------------------------------------------- change render ---- */

console.log("\nChange rendering");

const resolveMember = (id: string) => ({ "m-dad": "Dad", "m-mom": "Mom" })[id] ?? null;
const resolveCategory = (id: string) => ({ "c-fuel": { emoji: "⛽", name: "Fuel" } })[id] ?? null;

const amountChange = buildFeedChanges(base, { ...base, amount: "500.00" }, resolveMember, resolveCategory);
check(amountChange.length === 1 && amountChange[0].field === "amount", "amount-only diff yields one amount change");

const dateTimeChange = buildFeedChanges(
  base,
  { ...base, date: "2026-09-18", time: "15:10:00" },
  resolveMember,
  resolveCategory,
);
check(
  dateTimeChange.length === 1 && dateTimeChange[0].field === "dateTime",
  "date + time collapse into ONE combined change",
);

const memberChange = buildFeedChanges(base, { ...base, memberId: "m-mom" }, resolveMember, resolveCategory);
check(
  memberChange.length === 1 && memberChange[0].field === "memberId" && memberChange[0].after === "Mom",
  "member ids resolve to display names",
);

check(
  buildFeedChanges(null, base, resolveMember, resolveCategory).length === 0,
  "buildFeedChanges on a null pre-image returns []",
);

/* ------------------------------------------------------------- sanitising ---- */

console.log("\nSanitising");

check(sanitizeWhatsAppText("5*6") === "5∗6", "`*` cannot bold the remainder");
check(sanitizeWhatsAppText("a_b") === "a‐b", "`_` cannot open italics");
check(sanitizeWhatsAppText("~x~") === "∼x∼", "`~` cannot strike through");
check(sanitizeWhatsAppText("`code`") === "'code'", "backticks become apostrophes");
check(sanitizeWhatsAppText("line\nbreak") === "line break", "newlines collapse to a space");
check(sanitizeWhatsAppText("  padded  ") === "padded", "whitespace is trimmed");
check(categoryLabel(null) === UNCATEGORIZED_LABEL, "a null category renders Uncategorized");
check(categoryLabel({ emoji: "⛽", name: "Fuel" }) === "⛽ Fuel", "a category renders emoji + name");
check(categoryLabel({ emoji: "❔", name: "Fuel*" }) === "❔ Fuel∗", "category names are sanitised too");

/* --------------------------------------------------------------- message ---- */

console.log("\nMessage assembly");

const window = onBoundary;

function feed(partial: Partial<LedgerFeed>): LedgerFeed {
  return {
    window,
    added: [],
    edited: [],
    deleted: [],
    merges: [],
    counts: { added: 0, edited: 0, deleted: 0, merges: 0 },
    addedTotalPaise: 0,
    empty: true,
    ...partial,
  };
}

check(buildLedgerFeedMessage(feed({})) === null, "an empty feed produces NO message (D7)");

const oneAdded = feed({
  added: [
    { id: "t1", time: "09:14:00", date: "2026-09-18", amountPaise: 45000, note: "Petrol at Shell", category: { emoji: "⛽", name: "Fuel" } },
  ],
  counts: { added: 1, edited: 0, deleted: 0, merges: 0 },
  addedTotalPaise: 45000,
  empty: false,
});
const oneAddedMessage = buildLedgerFeedMessage(oneAdded) ?? "";
check(oneAddedMessage.startsWith("*Family Ledger — daily changes*\n_Thu 17 Sep 22:00 → Fri 18 Sep 22:00_"), "header + italic window label lead the message");
check(oneAddedMessage.includes("*Added (1)*"), "the Added header carries the TRUE count");
check(oneAddedMessage.includes("09:14 · ⛽ Fuel · ₹450.00"), "an added row renders time · category · amount");
check(oneAddedMessage.includes("\n   Petrol at Shell"), "a note sits on its own line with three leading spaces");
check(oneAddedMessage.includes("*Entered in this window: ₹450.00*"), "the closing total is additions-only");
check(!oneAddedMessage.includes("Edited") && !oneAddedMessage.includes("Deleted"), "empty sections are omitted entirely");

const noNote = buildLedgerFeedMessage(
  feed({
    added: [{ id: "t2", time: "10:00:00", date: "2026-09-18", amountPaise: 100, note: null, category: null }],
    counts: { added: 1, edited: 0, deleted: 0, merges: 0 },
    addedTotalPaise: 100,
    empty: false,
  }),
) ?? "";
check(noNote.includes("❔ Uncategorized"), "an uncategorized row renders the fixed label");
check(!noNote.includes("\n   "), "an empty note leaves no note line");

const backdated = buildLedgerFeedMessage(
  feed({
    added: [{ id: "t3", time: "09:14:00", date: "2026-09-12", amountPaise: 45000, note: null, category: { emoji: "⛽", name: "Fuel" } }],
    counts: { added: 1, edited: 0, deleted: 0, merges: 0 },
    addedTotalPaise: 45000,
    empty: false,
  }),
) ?? "";
check(backdated.includes("12 Sep 09:14 · ⛽ Fuel"), "a backdated row shows its own date (D2)");
check(!oneAddedMessage.includes("18 Sep 09:14"), "a same-day row prints no redundant date");

const longNote = buildLedgerFeedMessage(
  feed({
    added: [{ id: "t4", time: "09:14:00", date: "2026-09-18", amountPaise: 45000, note: "x".repeat(200), category: null }],
    counts: { added: 1, edited: 0, deleted: 0, merges: 0 },
    addedTotalPaise: 45000,
    empty: false,
  }),
) ?? "";
const noteLine = longNote.split("\n").find((line) => line.startsWith("   ")) ?? "";
check(noteLine.length === 3 + 80 && noteLine.endsWith("…"), "a note truncates at 80 characters with an ellipsis");

const editedMessage = buildLedgerFeedMessage(
  feed({
    edited: [
      {
        id: "a1",
        category: { emoji: "🍔", name: "Dining Out" },
        changes: [{ field: "amount", beforePaise: 45000, afterPaise: 50000 }],
      },
    ],
    counts: { added: 0, edited: 1, deleted: 0, merges: 0 },
    empty: false,
  }),
) ?? "";
check(editedMessage.includes("🍔 Dining Out · ₹450.00 → ₹500.00"), "an amount-only edit renders the compact form");
check(!editedMessage.includes("Entered in this window"), "the total line is omitted when there are no additions");

const multiFieldEdit = buildLedgerFeedMessage(
  feed({
    edited: [
      {
        id: "a2",
        category: { emoji: "🍔", name: "Dining Out" },
        changes: [
          { field: "amount", beforePaise: 45000, afterPaise: 50000 },
          { field: "note", before: "Petrol", after: "Petrol at Shell" },
          { field: "splitWith", before: [], after: ["Dad", "Mom"] },
        ],
      },
    ],
    counts: { added: 0, edited: 1, deleted: 0, merges: 0 },
    empty: false,
  }),
) ?? "";
check(
  multiFieldEdit.includes(
    `🍔 Dining Out · ₹450.00 → ₹500.00 · note: "Petrol" → "Petrol at Shell" · assigned: Nobody → Dad, Mom`,
  ),
  "multiple changes join with ` · `, ambiguous fields carry a prefix, amount does not",
);

// D6 netting (a delete + its Undo inside one window) happens in ledger-feed.ts,
// which needs the database. What is provable here is the rendered consequence:
// a feed whose Deleted section netted out to empty renders no Deleted section.
const deletedMessage = buildLedgerFeedMessage(
  feed({
    deleted: [{ id: "t9", amountPaise: 6000, note: "Auto to station", category: { emoji: "🚌", name: "Transport & Parking" } }],
    counts: { added: 0, edited: 0, deleted: 1, merges: 0 },
    empty: false,
  }),
) ?? "";
check(deletedMessage.includes("*Deleted (1)*"), "a deleted row produces its own section");
check(deletedMessage.includes("🚌 Transport & Parking · ₹60.00"), "a deleted row renders category · amount");

const mergesOnly = buildLedgerFeedMessage(
  feed({
    merges: [{ id: "a3", sourceName: "Fuel", targetName: "Transport & Parking", moved: 12 }],
    counts: { added: 0, edited: 0, deleted: 0, merges: 1 },
    empty: false,
  }),
) ?? "";
check(mergesOnly.includes('🔀 Merged "Fuel" into "Transport & Parking" · 12 entries moved'), "a merge renders one summary line");
check(
  (buildLedgerFeedMessage(feed({ merges: [{ id: "a4", sourceName: "F*el", targetName: "T", moved: 1 }], counts: { added: 0, edited: 0, deleted: 0, merges: 1 }, empty: false })) ?? "").includes(
    'Merged "F∗el" into "T" · 1 entry moved',
  ),
  "a merge name is sanitised and a single entry reads `1 entry moved`",
);
check(
  !mergesOnly.includes("*Edited") && !mergesOnly.includes("*Added"),
  "a merge does not appear as fake per-row edits",
);

const manyRows = Array.from({ length: 50 }, (_, index) => ({
  id: `t${index}`,
  time: "09:14:00",
  date: "2026-09-18",
  amountPaise: 100,
  note: null,
  category: null,
}));
const capped = buildLedgerFeedMessage(
  feed({
    added: manyRows,
    counts: { added: 50, edited: 0, deleted: 0, merges: 0 },
    addedTotalPaise: 5000,
    empty: false,
  }),
) ?? "";
check(capped.includes("*Added (50)*"), "the header count stays TRUE past the cap");
check(capped.includes("… and 10 more"), "a 50-row day truncates at 40 with `… and N more`");
check(
  capped.split("\n").filter((line) => line.startsWith("09:14")).length === 40,
  "exactly 40 rows are rendered",
);
check(capped.length < 50_000, "a capped message stays inside the length guard");

console.log(failures === 0 ? "\nAll ledger-feed checks passed.\n" : `\n${failures} ledger-feed check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
