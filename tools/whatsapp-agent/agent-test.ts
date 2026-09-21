/**
 * WhatsApp agent contract tests — `npm run test:whatsapp-agent`.
 *
 * The one thing that can be verified WITHOUT a phone, and the one thing that
 * matters most: `windowKeyFor(lastBoundary(t))` must be **byte-identical** to the
 * server's `feedWindowForInstant(t).key`. That string is the entire idempotency
 * contract between the two halves — if they ever disagree, the agent posts a
 * window the server does not recognise, the marker never matches, and the
 * family group gets a second message.
 *
 * So this file imports the SERVER's real implementation and compares it with the
 * agent's, over hand-picked edge instants and a deterministic random sweep,
 * rather than re-asserting the agent's arithmetic against itself.
 *
 * Everything else here is pure too — the retry ladder, the pre-network gate,
 * config validation and the CLI parsing — deliberately factored out of
 * `agent.mjs` so they can be tested without files, sockets or a device.
 *
 * What this CANNOT cover, and what the plan's §7 acceptance tests exist for:
 * linking, sending, the socket 401 path, the boot hook, and anything at all
 * about WhatsApp itself.
 */
import { feedWindowForInstant } from "../../src/lib/ledger-feed-window";
import {
  advanceLadder,
  createCacheStore,
  freshState,
  gateFor,
  lastBoundary,
  maskPhone,
  messageForRetry,
  nextBoundary,
  parseArgs,
  rememberMessage,
  RETRY_OFFSETS_MIN,
  validateConfig,
  windowKeyFor,
} from "./agent.mjs";

/**
 * A typed view of `parseArgs`' success shape.
 *
 * `agent.mjs` is plain JS, so TypeScript infers a union and — not being
 * type-checked itself — pins the nullable fields to `null` rather than
 * `string | null`. The cast keeps the assertions below readable; the behaviour
 * under test is still the real function, and `check()` still fails loudly if it
 * returns the error shape, since every field would then be `undefined`.
 */
type ParsedArgs = {
  mode?: string;
  at?: string | null;
  phone?: string | null;
  dryRun?: boolean;
  error?: string;
};
const args = (argv: string[]): ParsedArgs => parseArgs(argv) as ParsedArgs;

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string) {
  checks += 1;
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

/* ------------------------------------------------ the boundary contract ----- */

console.log("\nWindow contract (agent vs server)");

const EDGE_INSTANTS = [
  "2026-09-18T16:30:00.000Z", // exactly on a 22:00 IST boundary
  "2026-09-18T16:29:59.999Z", // one millisecond before it
  "2026-09-18T16:30:00.001Z", // one millisecond after it
  "2026-09-18T16:35:00.000Z", // 22:05 IST — a late fire
  "2026-09-18T00:00:00.000Z", // 05:30 IST
  "2026-12-31T16:30:00.000Z", // year rollover
  "2027-01-01T16:30:00.000Z",
  "2026-03-01T16:30:00.000Z", // month rollover
  "2028-02-28T16:30:00.000Z", // leap day window
  "2028-02-29T16:30:00.000Z",
  "2026-01-01T00:00:00.000Z",
  "2030-07-04T12:00:00.000Z",
];

let mismatched = 0;
for (const iso of EDGE_INSTANTS) {
  const instant = new Date(iso);
  const localKey = windowKeyFor(lastBoundary(instant));
  const localEnd = lastBoundary(instant).toISOString();
  const server = feedWindowForInstant(instant);
  if (localKey !== server.key || localEnd !== server.endIso) {
    mismatched += 1;
    console.error(`      ${iso}: agent ${localKey} / ${localEnd} vs server ${server.key} / ${server.endIso}`);
  }
}
check(mismatched === 0, `${EDGE_INSTANTS.length} edge instants: key AND end instant are byte-identical to the server`);
check(
  windowKeyFor(lastBoundary(new Date("2026-09-18T16:30:00.000Z"))) === "2026-09-17..2026-09-18",
  "a known boundary produces the expected key",
);
check(
  windowKeyFor(lastBoundary(new Date("2026-09-18T16:29:59.999Z"))) === "2026-09-16..2026-09-17",
  "one millisecond earlier resolves to the PREVIOUS window",
);

// A deterministic sweep, so a future refactor of either side cannot quietly
// drift apart between the hand-picked cases. Fixed seed — reproducible failures.
let seed = 20260918;
function nextRandom() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const SWEEP = 400;
let sweepMismatches = 0;
for (let i = 0; i < SWEEP; i += 1) {
  const instant = new Date(Date.UTC(2026, 0, 1) + Math.floor(nextRandom() * 4 * 365 * 24 * 60 * 60 * 1000));
  if (windowKeyFor(lastBoundary(instant)) !== feedWindowForInstant(instant).key) sweepMismatches += 1;
}
check(sweepMismatches === 0, `${SWEEP} random instants across four years agree (deterministic seed)`);

/* ------------------------------------------------------------ nextBoundary -- */

console.log("\nnextBoundary");

const nextFromLate = nextBoundary(new Date("2026-09-18T16:35:00.000Z"));
check(nextFromLate.toISOString() === "2026-09-19T16:30:00.000Z", "just after a boundary, the next one is tomorrow");
const nextFromEarly = nextBoundary(new Date("2026-09-18T16:29:00.000Z"));
check(nextFromEarly.toISOString() === "2026-09-18T16:30:00.000Z", "just before a boundary, the next one is minutes away");
const nextOnBoundary = nextBoundary(new Date("2026-09-18T16:30:00.000Z"));
check(nextOnBoundary.toISOString() === "2026-09-19T16:30:00.000Z", "exactly on a boundary, the same instant is not reused");

let boundaryProblems = 0;
const DAY_MS = 24 * 60 * 60 * 1000;
for (const iso of EDGE_INSTANTS) {
  const now = new Date(iso);
  const next = nextBoundary(now);
  const delta = next.getTime() - now.getTime();
  // Strictly in the future, and never further out than one whole day.
  if (delta <= 0 || delta > DAY_MS) boundaryProblems += 1;
  // Always 16:30:00.000 UTC — which is 22:00 IST at a constant +05:30.
  //
  // Deliberately NOT "a whole-day UTC instant": the boundary is 16:30 UTC, so
  // asserting midnight UTC would only pass in the +05:30-less world where IST
  // were UTC. Stating the real invariant is the point of this check — it is what
  // keeps the agent firing at the same instant the server's window closes.
  if (
    next.getUTCHours() !== 16 ||
    next.getUTCMinutes() !== 30 ||
    next.getUTCSeconds() !== 0 ||
    next.getUTCMilliseconds() !== 0
  ) {
    boundaryProblems += 1;
  }
}
check(boundaryProblems === 0, "nextBoundary is always 0–24 h ahead and lands exactly on 16:30 UTC (22:00 IST)");

/* ----------------------------------------------------------- the ladder ---- */

console.log("\nRetry ladder (persisted, P4)");

/**
 * The same plain-JS inference quirk as `ParsedArgs`: `freshState()` returns an
 * object whose null fields TypeScript pins to `null`, so the state has to be
 * described once, explicitly, before a ladder can be advanced through it.
 */
type AgentState = {
  key: string;
  attempts: number;
  firstFailureAt: string | null;
  nextAttemptAt: string | null;
  exhausted: boolean;
};

const T0 = new Date("2026-09-18T16:30:00.000Z");
let ladder: AgentState = freshState("2026-09-17..2026-09-18");
check(ladder.attempts === 0 && !ladder.exhausted, "a fresh state has no attempts and is not exhausted");

const cumulative: number[] = [];
for (let i = 1; i <= 5; i += 1) {
  ladder = advanceLadder(ladder, T0);
  cumulative.push(ladder.nextAttemptAt ? (Date.parse(ladder.nextAttemptAt) - T0.getTime()) / 60_000 : -1);
}
check(ladder.attempts === 5, "five failures are counted");
check(ladder.exhausted === true, "the 5th failure exhausts the ladder");
check(ladder.firstFailureAt === T0.toISOString(), "firstFailureAt is pinned to the FIRST failure, not the last");
check(
  JSON.stringify(cumulative) === JSON.stringify([2, 5, 15, 30, -1]),
  `offsets from the first failure are 2/5/15/30 min then exhaustion (got ${cumulative.join("/")})`,
);
check(RETRY_OFFSETS_MIN.length === 5, "the offset table matches the plan's five-attempt table");
check(ladder.key === "2026-09-17..2026-09-18", "the state stays keyed to its window");

/* ------------------------------------------------------------- the gate ---- */

console.log("\nPre-network gate (zero network calls when false)");

const KEY = "2026-09-17..2026-09-18";
check(gateFor({ key: KEY, state: freshState(KEY), hasMarker: false, now: T0 }).run === true, "no marker, no ladder → run");
check(
  gateFor({ key: KEY, state: freshState(KEY), hasMarker: true, now: T0 }).reason === "already-posted",
  "a local marker short-circuits the gate",
);
check(
  gateFor({ key: KEY, state: { ...freshState(KEY), exhausted: true }, hasMarker: false, now: T0 }).reason === "exhausted",
  "an exhausted ladder short-circuits the gate",
);
const waiting: AgentState = {
  ...freshState(KEY),
  attempts: 1,
  firstFailureAt: T0.toISOString(),
  nextAttemptAt: new Date(T0.getTime() + 120_000).toISOString(),
};
check(gateFor({ key: KEY, state: waiting, hasMarker: false, now: T0 }).reason === "waiting", "before nextAttemptAt → no fetch at all");
check(
  gateFor({ key: KEY, state: waiting, hasMarker: false, now: new Date(T0.getTime() + 120_000) }).run === true,
  "at nextAttemptAt → the retry runs",
);
check(
  gateFor({ key: "2026-09-18..2026-09-19", state: waiting, hasMarker: false, now: T0 }).run === true,
  "a new window discards the previous window's ladder",
);
check(
  gateFor({ key: "2026-09-18..2026-09-19", state: { ...freshState(KEY), exhausted: true }, hasMarker: false, now: T0 }).run === true,
  "a new window is not blocked by LAST night's exhaustion",
);

/* -------------------------------------------------------------- config ----- */

console.log("\nConfig validation");

const GOOD = {
  apiUrl: "https://tokenscript.vercel.app",
  token: "a".repeat(64),
  phone: "919876543210",
  groupJid: "120363012345678901@g.us",
  sendAt: "22:00",
  timezone: "Asia/Kolkata",
};
check(validateConfig(GOOD).ok, "a complete config validates");
check(validateConfig({ ...GOOD, apiUrl: "https://x.vercel.app/" }).config?.apiUrl === "https://x.vercel.app", "a trailing slash is trimmed");
check(validateConfig({ ...GOOD, groupJid: "" }).ok, "an empty groupJid is allowed (needed by --link and --groups)");

const rejects = (label: string, config: Record<string, unknown>, needle: string) => {
  const result = validateConfig(config);
  const text = result.errors.join(" | ");
  check(!result.ok && text.includes(needle), `${label} (got: ${result.ok ? "accepted" : text.slice(0, 90)})`);
};
rejects("missing token", { ...GOOD, token: "" }, "token is required");
rejects("a truncated token", { ...GOOD, token: "abc" }, "truncated");
rejects("missing apiUrl", { ...GOOD, apiUrl: "" }, "absolute http(s) URL");
rejects("a phone with a plus sign", { ...GOOD, phone: "+919876543210" }, "digits only");
rejects("a phone with spaces", { ...GOOD, phone: "91 98765 43210" }, "digits only");
rejects("a phone that is too short", { ...GOOD, phone: "1234" }, "digits only");
rejects("a malformed groupJid", { ...GOOD, groupJid: "Family Ledger" }, "@g.us");
rejects("sendAt 20:00", { ...GOOD, sendAt: "20:00" }, "fixed server-side");
rejects("a different timezone", { ...GOOD, timezone: "America/New_York" }, "Asia/Kolkata");
rejects("an object that is not a config", null as unknown as Record<string, unknown>, "must contain an object");

/* ---------------------------------------------------------------- args ----- */

console.log("\nCLI parsing");

check(args([]).mode === "scheduler", "no flags → the scheduler (the production path)");
check(args(["--link"]).mode === "link", "--link is a mode");
check(args(["--now"]).mode === "now", "--now is a mode");
check(args(["--at", "2026-09-17T16:30:00.000Z"]).at === "2026-09-17T16:30:00.000Z", "--at keeps the instant");
check(args(["--at", "2026-09-17T22:00:00+05:30"]).at === "2026-09-17T22:00:00+05:30", "--at accepts a non-UTC offset");
check(args(["--at", "2026-09-17T16:30:00.000Z", "--dry-run"]).dryRun === true, "--dry-run combines with --at");
check(args(["--link", "--phone", "919876543210"]).phone === "919876543210", "--phone overrides the config number");

const badArgs: Array<[string, string[], string]> = [
  ["conflicting modes", ["--link", "--now"], "choose only one"],
  ["two instants", ["--at", "2026-09-17T16:30:00.000Z", "--at", "2026-09-18T16:30:00.000Z"], "choose only one"],
  ["--at without an offset", ["--at", "2026-09-17T16:30:00"], "WITH an offset"],
  ["--at with garbage", ["--at", "yesterday"], "WITH an offset"],
  ["--at without a value", ["--at"], "needs an ISO instant"],
  ["--dry-run alone", ["--dry-run"], "combined with --now or --at"],
  ["an unknown flag", ["--send"], "unknown argument"],
];
for (const [label, argv, needle] of badArgs) {
  const result = parseArgs(argv) as { error?: string };
  check(Boolean(result.error?.includes(needle)), `${label} is refused (${result.error?.slice(0, 60)})`);
}

/* ------------------------------------------------- the Baileys-side caches -- */

console.log("\nOutgoing-message store (the retry path)");

const sent = { key: { id: "3EB0ABCDEF", remoteJid: "1203630@g.us" }, message: { conversation: "hello" } };
check(messageForRetry("3EB0ABCDEF") === undefined, "an unknown id answers undefined");
rememberMessage(sent);
check(messageForRetry("3EB0ABCDEF") === sent, "a remembered message comes back by id — this is what a retry needs");
rememberMessage({ key: {} });
rememberMessage({});
check(messageForRetry(undefined) === undefined, "a message with no id is ignored, not stored under undefined");
rememberMessage({ key: { id: "3EB0ABCDEF" }, message: { conversation: "replacement" } });
check(
  messageForRetry("3EB0ABCDEF").message.conversation === "replacement",
  "re-sending under the same id replaces the stored message",
);

// The bound is what keeps a months-long run from growing this map forever.
for (let i = 0; i < 120; i += 1) rememberMessage({ key: { id: `bulk-${i}` } });
check(messageForRetry("3EB0ABCDEF") === undefined, "the store is bounded — the oldest entries are evicted");
check(messageForRetry("bulk-119") !== undefined, "and the newest entries survive");

console.log("\nRetry counter cache (Baileys' msgRetryCounterCache)");

const cache = createCacheStore();
check(cache.get("a") === undefined, "a miss is undefined");
cache.set("a", 1);
check(cache.get("a") === 1, "set/get round-trip");
cache.set("a", 2);
check(cache.get("a") === 2, "set overwrites");
cache.del("a");
check(cache.get("a") === undefined, "del removes");
cache.set("b", 1);
cache.flushAll();
check(cache.get("b") === undefined, "flushAll clears everything");
// Two stores must not share state — each socket gets its own counter.
const other = createCacheStore();
other.set("c", 9);
check(cache.get("c") === undefined && other.get("c") === 9, "each store is independent");

/* ----------------------------------------------------------------- odds ----- */

console.log("\nLog hygiene helpers");

check(maskPhone("919876543210") === "91••••••3210", "the phone number is masked for logs");
check(!maskPhone("919876543210").includes("98765"), "the masked form does not contain the middle digits");

// The count is printed, not just the verdict: `scripts/check-doc-counts.mjs` reads it
// to hold the plan and the spec to what this suite really runs. A bare "all passed"
// is how the docs came to claim 51 checks for a suite that ran 63.
console.log(
  failures === 0
    ? `\nAll ${checks} whatsapp-agent checks passed.\n`
    : `\n${failures} of ${checks} whatsapp-agent check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
