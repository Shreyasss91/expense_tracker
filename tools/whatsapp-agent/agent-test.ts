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
  buildAgentConfig,
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

/* --------------------------------------------------------- config builder -- */

// `npm run init:whatsapp-agent-config` writes config.json on the laptop from
// `.env.local`, so these pin the same rules a hand-written file gets — the
// generator must not be a second, laxer path into the agent's config.

console.log("\nConfig builder (init:whatsapp-agent-config)");

const JID = "120363012345678901@g.us";
const ENV_VALUES = {
  prodUrl: "https://tokenscript.vercel.app/",
  token: "b".repeat(64),
  phone: "919663322589",
};

const built = buildAgentConfig(ENV_VALUES);
check(built.ok, "the values in .env.local build a config");
check(
  built.ok && built.config?.apiUrl === "https://tokenscript.vercel.app",
  "a trailing slash on PROD_URL is trimmed, exactly as it is for a hand-written config",
);
check(
  built.ok && built.config?.sendAt === "22:00" && built.config?.timezone === "Asia/Kolkata",
  "sendAt and timezone come out fixed — they are constants, not inputs",
);
check(
  built.ok && Object.keys(built.config ?? {}).join(",") === "apiUrl,token,phone,groupJid,sendAt,timezone",
  "the key order matches config.example.json, so a generated file diffs cleanly",
);

// `agent.mjs` is plain JS, so TypeScript infers `previous`'s type from its `null`
// default rather than from what `JSON.parse` can actually hand back. This is the
// same trade-off the `parseArgs` view above makes: the real function is under
// test, and every value passed through here is one the script can encounter.
const asInputs = (inputs: Record<string, unknown>) =>
  inputs as unknown as Parameters<typeof buildAgentConfig>[0];

const buildRejects = (label: string, inputs: Record<string, unknown>, needle: string) => {
  const result = buildAgentConfig(asInputs(inputs));
  const text = result.errors.join(" | ");
  check(!result.ok && text.includes(needle), `${label} (got: ${result.ok ? "accepted" : text.slice(0, 90)})`);
};
buildRejects(
  "a phone with a plus sign is refused, never repaired",
  { ...ENV_VALUES, phone: "+919663322589" },
  "digits only",
);
buildRejects("a phone with spaces is refused", { ...ENV_VALUES, phone: "91 96633 22589" }, "digits only");
buildRejects("a missing token", { ...ENV_VALUES, token: "" }, "token is required");
buildRejects("a missing deployment URL", { ...ENV_VALUES, prodUrl: "" }, "absolute http(s) URL");

check(
  built.ok && built.config?.groupJid === "",
  "a JID is never invented — a first run leaves it empty, for the phone to fill",
);
check(
  !buildAgentConfig({ prodUrl: "", token: "", phone: "" }).errors.some(
    (error) => error.includes("sendAt") || error.includes("timezone"),
  ),
  "the constants can never be reported as wrong — they are not parameters",
);

/* ------------------------------------ a regenerate must not blank the JID -- */

// The `--force` path is the one that can break a phone that is already working,
// and it breaks SILENTLY: the JID goes back to empty, the next `adb push` carries
// that to Termux, and the agent simply refuses to post at 22:00. Nothing reports
// it, on either side, because the two copies of config.json never see each other.
//
// What is testable here is the rule the laptop's copy obeys: a JID it already
// holds survives a regenerate. What is NOT testable is a JID that exists only on
// the phone — this script cannot read the phone. That case is mitigated by the
// inheritance below being the ONLY route a JID has into the file, by the warning
// the script prints when it writes an empty one, and by `--groups` reproducing it
// in seconds; it is a documentation problem rather than a code one, which is why
// the checklist now says the JID belongs in the laptop's copy too.

console.log("\nConfig builder — a regenerate must not blank the group JID");

// A previous file that was really there: it recorded the deployment it was built
// for, which is what makes these checks sharp instead of accidental.
const PREVIOUS_API = "https://tokenscript.vercel.app";
const previousFile = (over: Record<string, unknown> = {}) => ({ apiUrl: PREVIOUS_API, groupJid: JID, ...over });

const inherited = buildAgentConfig(asInputs({ ...ENV_VALUES, previous: previousFile() }));
check(inherited.ok && inherited.config?.groupJid === JID, "an existing JID is inherited, not regenerated");
check(
  inherited.ok && inherited.config?.token === ENV_VALUES.token,
  "while everything else is still rebuilt from .env.local",
);

// The real shape of the failure: a rotated token and a new number on the SAME
// deployment are what force the use of `--force`.
const rotated = buildAgentConfig(
  asInputs({
    prodUrl: PREVIOUS_API,
    token: "c".repeat(64),
    phone: "919600000000",
    previous: previousFile(),
  }),
);
check(
  rotated.ok && rotated.config?.groupJid === JID,
  "rotating the token and the number — the --force case — still keeps the JID",
);
check(
  rotated.ok && rotated.config?.token === "c".repeat(64),
  "and the rotation really did happen — the JID is not preserved by ignoring the inputs",
);

const slashy = buildAgentConfig(
  asInputs({ ...ENV_VALUES, previous: previousFile({ apiUrl: `${PREVIOUS_API}/` }) }),
);
check(slashy.ok && slashy.config?.groupJid === JID, "a trailing slash in the old apiUrl is still the same deployment");

const padded = buildAgentConfig(asInputs({ ...ENV_VALUES, previous: previousFile({ groupJid: `  ${JID}  ` }) }));
check(padded.ok && padded.config?.groupJid === JID, "a padded JID is trimmed");

/* ----------------------------------------------- the deployment must match -- */

// A JID names a WhatsApp GROUP, not a deployment. Inheriting one across a changed
// `apiUrl` would post THIS server's ledger into whatever group the other
// deployment was feeding — a leak with no error attached to it — so the default is
// a refusal and the way past it has to be explicit.

const newDeployment = buildAgentConfig(
  asInputs({ ...ENV_VALUES, prodUrl: "https://staging.vercel.app", previous: previousFile() }),
);
check(newDeployment.ok, "a changed deployment still builds a valid config");
check(
  newDeployment.ok && newDeployment.config?.groupJid === "",
  "but the JID is NOT carried across it — that group is the other server's audience",
);
check(
  newDeployment.ok && newDeployment.config?.apiUrl === "https://staging.vercel.app",
  "and the written apiUrl is the new one",
);

const deliberateMove = buildAgentConfig(
  asInputs({
    ...ENV_VALUES,
    prodUrl: "https://staging.vercel.app",
    previous: previousFile(),
    keepGroupJid: true,
  }),
);
check(
  deliberateMove.ok && deliberateMove.config?.groupJid === JID,
  "--keep-jid carries it over anyway, for a move that really is the same audience",
);

const noApiUrl = buildAgentConfig(asInputs({ ...ENV_VALUES, previous: previousFile({ apiUrl: undefined }) }));
check(
  noApiUrl.ok && noApiUrl.config?.groupJid === "",
  "an old file recording no apiUrl cannot be shown to be the same deployment → fail closed",
);

const stillEmpty = buildAgentConfig(asInputs({ ...ENV_VALUES, previous: previousFile({ groupJid: "" }) }));
check(
  stillEmpty.ok && stillEmpty.config?.groupJid === "",
  "an empty JID in the old file stays empty — still nothing invented",
);

// `JSON.parse` can hand back anything at all, and the worst case is a number:
// `123` would stringify into something JID-shaped that is not a JID at all. The
// apiUrl matches here, so the ONLY reason each of these is absent is its type.
for (const junk of [
  null,
  42,
  "text",
  [],
  { apiUrl: PREVIOUS_API, groupJid: 123 },
  { apiUrl: PREVIOUS_API, groupJid: null },
]) {
  const result = buildAgentConfig(asInputs({ ...ENV_VALUES, previous: junk }));
  check(
    result.ok && result.config?.groupJid === "",
    `a previous value that is not a JID is treated as absent (${JSON.stringify(junk)})`,
  );
}

// A string that is present but malformed must be refused LOUDLY rather than
// dropped quietly — the operator then knows the phone's JID needs re-discovering.
buildRejects(
  "a malformed JID already in config.json",
  { ...ENV_VALUES, previous: previousFile({ groupJid: "Family Ledger" }) },
  "@g.us",
);

// There is no `groupJid` input, so nothing a human can put in `.env.local` — a
// future `DIGEST_AGENT_GROUP`, say — can arrive as an empty string and blank a JID
// the phone is posting to. Casting past the input type is the only way to even
// express this call, which is the point of the test.
const blanking = buildAgentConfig(
  asInputs({ ...ENV_VALUES, groupJid: "", previous: previousFile() }),
);
check(blanking.ok && blanking.config?.groupJid === JID, "no input exists that can blank an inherited JID");

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
