/**
 * Daily ledger feed verification — `npm run verify:digest-feed`.
 *
 * Answers one question about the deployed app: **do `/api/digest/day` and its
 * auth behave exactly as docs/SPEC_DAILY_LEDGER_WHATSAPP_FEED.md promises?**
 *
 * It is the spec's §8 manual curl block made runnable, plus the checks a human
 * would not bother doing by hand:
 *
 *   1. Auth — unauthenticated and wrong-token requests are refused with 401,
 *      and a `503` is reported as its own diagnosis ("the deployment has no
 *      secret") rather than lumped in with "the token is wrong". Those two
 *      failures need different fixes, which is the whole reason the route
 *      distinguishes them.
 *   2. Window math — `?at=` pins the instant, so the boundary arithmetic is
 *      checked against an INDEPENDENT implementation in this file (fixed
 *      +05:30; India has no DST) at exact-boundary, one-second-before,
 *      month-rollover, year-rollover and late-fire instants. This is the part
 *      that silently produces a second, shifted window if it ever regresses.
 *   3. `stale` — true only past the 6 h grace period, which is what stops a
 *      two-day-old window from being posted as if it were tonight's.
 *   4. Message shape — the header, the balanced `*` markdown, the section
 *      presence rules and the additions-only total.
 *   5. POST argument handling — the paths that write nothing, including the
 *      semantic `windowKey` rejections (an impossible date, a range that is not
 *      24 h, a window that has not ended yet). Those probes deliberately use
 *      `status: "failed"`, the one status that records nothing, so running this
 *      against a build that predates the hardening cannot leave a junk marker
 *      behind.
 *
 * **What this deliberately does NOT do: POST `status: "sent"`.** That call is
 * the real confirmation path, and against a live window it would write the send
 * marker — suppressing tonight's post and disabling the 22:15 fallback. There
 * is no delete endpoint, so the marker could not be undone from here. The
 * writing path is therefore verified by the agent itself the first time it
 * posts, not by this script. The `failed` path IS exercised (it writes
 * nothing), and its no-write guarantee is checked by reading the window's
 * `alreadySent` before and after.
 *
 * That `failed` call makes the deployment log one line — `digest/day reported a
 * failed send` — carrying the detail string below, so a reader of the logs is
 * not left wondering about a phantom outage.
 *
 * Env:
 *   PROD_URL              default https://tokenscript.vercel.app
 *   DIGEST_AGENT_TOKEN    the same value set on Vercel (guards the route)
 *
 * `.env.local` is loaded by `loadLiveEnv()`, which ABORTS when the shell already
 * exports one of its variables with a different value — a stale exported token
 * would otherwise read as "production rejects our token".
 */
import { loadLiveEnv } from "./lib/live.mjs";

loadLiveEnv();

const BASE = process.env.PROD_URL ?? "https://tokenscript.vercel.app";
const TOKEN = process.env.DIGEST_AGENT_TOKEN ?? "";

/**
 * Mirrors `MAX_MESSAGE_CHARS` in src/lib/ledger-feed-format.ts. Duplicated on
 * purpose: if the module's cap changes, this check must be updated to match,
 * and a shared import would hide that.
 */
const MAX_MESSAGE_CHARS = 50_000;

/** The 6 h freshness grace period — `FEED_GRACE_MS` in src/lib/ledger-feed-window.ts. */
const FEED_GRACE_MS = 6 * 60 * 60 * 1000;

/** `FEED_KEY_RE` — the `<start>..<end>` idempotency key. */
const FEED_KEY_RE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;

/** Mirrors the message builder's first line — the only place it is written. */
const HEADER = "*Family Ledger — daily changes*";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

let failures = 0;
function check(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

function note(msg) {
  console.log(`  ⓘ ${msg}`);
}

/** A response body for a failure message: whitespace collapsed, tags stripped, capped. */
function snippet(text) {
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}

/* ---------------------------------------------------- the independent math --- */

/** IST calendar date (YYYY-MM-DD) of an instant. */
function istDateOf(ms) {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The 22:00 IST boundary instant of an IST calendar date. */
function boundaryForIstDate(istDate) {
  return Date.parse(`${istDate}T22:00:00.000Z`) - IST_OFFSET_MS;
}

/** Calendar-day subtraction on a YYYY-MM-DD string. */
function previousIsoDate(isoDate) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** IST wall clock, `yyyy-MM-dd HH:mm`. */
function istWallClock(ms) {
  // Shift into "UTC" so the ISO string IS the IST wall clock — no DST to
  // account for, which is exactly why this arithmetic is safe here.
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");
}

/**
 * The message header label, e.g. "Wed 17 Sep 22:00".
 *
 * The month abbreviation is taken from this table rather than from
 * `Intl`'s `month: "short"`, which renders September as "Sept" — four letters
 * where date-fns' `MMM` (the server's formatter) renders "Sep". Reading the
 * month number and indexing here keeps the two sides comparable.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function istLabel(ms) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.hour}:${parts.minute}`;
}

/**
 * The window an instant must resolve to: the most recent 22:00 IST boundary
 * that has already passed, minus 24 h. Written from the spec's prose rather
 * than imported from the app, so it can disagree with production.
 */
function expectedWindow(ms) {
  const today = istDateOf(ms);
  const end = ms >= boundaryForIstDate(today) ? boundaryForIstDate(today) : boundaryForIstDate(previousIsoDate(today));
  const start = end - 24 * 60 * 60 * 1000;
  const startDateIst = istDateOf(start);
  const endDateIst = istDateOf(end);
  return {
    key: `${startDateIst}..${endDateIst}`,
    startIso: new Date(start).toISOString(),
    endIso: new Date(end).toISOString(),
    startIst: istWallClock(start),
    endIst: istWallClock(end),
    startDateIst,
    endDateIst,
    label: `${istLabel(start)} → ${istLabel(end)}`,
    stale: ms - end > FEED_GRACE_MS,
  };
}

/* -------------------------------------------------------------- the calls --- */

async function get(path, { token = TOKEN, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { ...headers, authorization: `Bearer ${token}` } : headers,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // A non-JSON body means something other than this route answered (a login
    // redirect, an HTML error page) — keep the raw text for the failure message.
  }
  return { status: res.status, body, raw: text };
}

async function post(payload, { token = TOKEN } = {}) {
  const res = await fetch(`${BASE}/api/digest/day`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* see get() */
  }
  return { status: res.status, body, raw: text };
}

/** `at` is always an ISO instant WITH an offset, so encode the colon. */
const atQuery = (iso) => `at=${encodeURIComponent(iso)}`;

function assertWindow(window, expected, label) {
  check(window?.key === expected.key, `${label}: key is ${expected.key} (got ${window?.key})`);
  check(window?.startIso === expected.startIso, `${label}: start is ${expected.startIso} (got ${window?.startIso})`);
  check(window?.endIso === expected.endIso, `${label}: end is ${expected.endIso} (got ${window?.endIso})`);
  check(window?.startIst === expected.startIst, `${label}: startIst is "${expected.startIst}" (got "${window?.startIst}")`);
  check(window?.endIst === expected.endIst, `${label}: endIst is "${expected.endIst}" (got "${window?.endIst}")`);
  check(window?.endDateIst === expected.endDateIst, `${label}: endDateIst is ${expected.endDateIst} (got ${window?.endDateIst})`);
  check(window?.label === expected.label, `${label}: label is "${expected.label}" (got "${window?.label}")`);
  check(window?.stale === expected.stale, `${label}: stale is ${expected.stale} (got ${window?.stale})`);
}

/** Shape checks that must hold for every successful GET, whatever the window. */
function assertEnvelope(body, label) {
  check(body?.ok === true, `${label}: ok is true`);
  check(typeof body?.empty === "boolean", `${label}: empty is a boolean`);
  check(typeof body?.disabled === "boolean", `${label}: disabled is a boolean`);
  check(typeof body?.alreadySent === "boolean", `${label}: alreadySent is a boolean`);
  check(typeof body?.stale === "boolean", `${label}: stale is a boolean`);
  check(body?.sentAt === null || typeof body?.sentAt === "string", `${label}: sentAt is null or an ISO string`);
  check(
    body?.alreadySent === Boolean(body?.sentAt),
    `${label}: alreadySent and sentAt agree (${body?.alreadySent} / ${body?.sentAt})`,
  );
  const counts = body?.counts;
  check(
    ["added", "edited", "deleted", "merges"].every((k) => Number.isInteger(counts?.[k]) && counts[k] >= 0),
    `${label}: counts carries four non-negative integers (${JSON.stringify(counts)})`,
  );
  check(
    body?.text === null || typeof body?.text === "string",
    `${label}: text is null or a string`,
  );
  // D7 — nothing to say means nothing is posted, and the two must never disagree.
  if (body?.empty) check(body?.text === null, `${label}: an empty window returns text: null`);
  if (body?.disabled) check(body?.text === null, `${label}: a disabled feed builds no message`);
  if (body?.alreadySent) check(body?.text === null, `${label}: an already-recorded window is not re-built`);
}

/** The §5.4.6 message contract, checked against the counts the same call returned. */
function assertMessage(body, label) {
  const text = body?.text;
  if (typeof text !== "string") {
    note(`${label}: no message to inspect (empty, disabled or already sent)`);
    return;
  }

  const lines = text.split("\n");
  check(lines[0] === HEADER, `${label}: first line is the exact header`);
  check(/^_.+_$/.test(lines[1] ?? ""), `${label}: second line is the italic window label (got "${lines[1]}")`);
  check(
    (lines[1] ?? "").slice(1, -1) === body.window?.label,
    `${label}: the italic label matches the window the same response returned`,
  );
  check(text.length <= MAX_MESSAGE_CHARS, `${label}: within the character cap (${text.length})`);

  // The builder bolds with `*…*`; an odd count means an unbalanced marker, which
  // WhatsApp renders as literal asterisks spilling across lines.
  const asterisks = (text.match(/\*/g) ?? []).length;
  check(asterisks % 2 === 0, `${label}: markdown bold markers are balanced (${asterisks} asterisks)`);

  const counts = body.counts ?? {};
  const hasSection = (title) => new RegExp(`^\\*${title} \\(${counts[title.toLowerCase()]}\\)\\*$`, "m").test(text);

  check(
    counts.added > 0 ? hasSection("Added") : !text.includes("*Added ("),
    `${label}: the Added section is present exactly when there are additions`,
  );
  check(
    counts.edited > 0 ? hasSection("Edited") : !text.includes("*Edited ("),
    `${label}: the Edited section is present exactly when there are edits`,
  );
  check(
    counts.deleted > 0 ? hasSection("Deleted") : !text.includes("*Deleted ("),
    `${label}: the Deleted section is present exactly when there are deletions`,
  );

  // The total counts ADDITIONS only and says "Entered" — with no additions the
  // line must be absent rather than reading ₹0.
  const totalLine = /^\*Entered in this window: (.+)\*$/m.exec(text);
  check(
    counts.added > 0 ? totalLine !== null : totalLine === null,
    `${label}: the "Entered in this window" total is present exactly when there are additions`,
  );
  if (totalLine) {
    check(/^₹[\d,]+(\.\d{2})?$/.test(totalLine[1]), `${label}: the total is a rupee amount (got "${totalLine[1]}")`);
  }
}

/* ----------------------------------------------------------------- main ---- */

const PINNED = [
  // exact boundary: now >= today's 22:00 → tonight's window
  ["2026-09-18T16:30:00.000Z", "exact boundary"],
  // one second earlier → still the PREVIOUS window
  ["2026-09-18T16:29:59.000Z", "one second before the boundary"],
  // late fire → identical key to the boundary run (the agent may run at 22:07)
  ["2026-09-18T16:35:00.000Z", "late fire (22:05 IST)"],
  // 7 h after a boundary → past the 6 h grace period
  ["2026-09-19T23:30:00.000Z", "7 h after a boundary"],
  // month rollover
  ["2026-03-01T16:30:00.000Z", "month rollover"],
  // year rollover
  ["2027-01-01T16:30:00.000Z", "year rollover"],
];

async function main() {
  if (!TOKEN) {
    throw new Error(
      "no agent token — set DIGEST_AGENT_TOKEN in .env.local to the value configured on Vercel",
    );
  }

  console.log(`⏱ Verifying the daily ledger feed at ${BASE}\n`);

  /* 1 — auth ------------------------------------------------------------- */
  console.log("Auth");
  const anonymous = await get("/api/digest/day", { token: "" });
  // 404 is its own failure, and the likeliest one right after a push: the route
  // exists in the repo but the running deployment predates it. Without this
  // branch the run reported "got 404" four times and then dumped a page of
  // minified HTML at the reader, which buries the one useful fact.
  if (anonymous.status === 404) {
    check(false, "GET with no Authorization → 401 (got 404)");
    throw new Error(
      `${BASE} does not serve /api/digest/day (404). The route is missing from the running ` +
        "deployment, so it predates the commit that added this feature — the token cannot be " +
        "judged until it is deployed. Check the Vercel deployment for the latest commit " +
        "(`npm run build` proves the route compiles locally) and re-run.",
    );
  }
  check(anonymous.status === 401, `GET with no Authorization → 401 (got ${anonymous.status})`);

  const wrongToken = await get("/api/digest/day", { token: "not-the-token" });
  check(wrongToken.status === 401, `GET with a wrong token → 401 (got ${wrongToken.status})`);

  const anonymousPost = await post({ windowKey: "2026-09-17..2026-09-18", status: "sent" }, { token: "" });
  check(anonymousPost.status === 401, `POST with no Authorization → 401 (got ${anonymousPost.status})`);

  const live = await get("/api/digest/day");
  // 503 and 401 mean different things and need different fixes, so they are
  // reported separately rather than as one "GET failed".
  if (live.status === 503) {
    check(false, "GET with the token → 200 (got 503: the deployment has no DIGEST_AGENT_TOKEN — set it on Vercel and redeploy)");
    throw new Error("the deployment is not configured");
  }
  check(live.status === 200, `GET with the token → 200 (got ${live.status})`);
  if (live.status !== 200) throw new Error(`unexpected GET response (http ${live.status}): ${snippet(live.raw)}`);

  // Shape only for the live window: it is derived from the server's own clock,
  // and pinning it would make this run flaky in the seconds around 22:00.
  check(FEED_KEY_RE.test(live.body?.window?.key ?? ""), `the live window key is ${live.body?.window?.key}`);
  check(/22:00$/.test(live.body?.window?.endIst ?? ""), `the live window ends on a 22:00 IST boundary (${live.body?.window?.endIst})`);
  check(
    Date.parse(live.body?.window?.endIso) - Date.parse(live.body?.window?.startIso) === 24 * 60 * 60 * 1000,
    "the live window spans exactly 24 h",
  );
  assertEnvelope(live.body, "live window");
  assertMessage(live.body, "live window");

  /* 2 — window math at pinned instants ----------------------------------- */
  console.log("\nWindow math (pinned with ?at=)");
  const keys = new Map();
  for (const [iso, label] of PINNED) {
    const res = await get(`/api/digest/day?${atQuery(iso)}`);
    if (res.status !== 200) {
      check(false, `${label}: GET → 200 (got ${res.status} ${res.raw.slice(0, 120)})`);
      continue;
    }
    const expected = expectedWindow(Date.parse(iso));
    assertWindow(res.body?.window, expected, label);
    assertEnvelope(res.body, label);
    assertMessage(res.body, label);
    keys.set(label, res.body?.window?.key);
  }

  const [boundaryKey, beforeKey, lateKey] = [
    keys.get("exact boundary"),
    keys.get("one second before the boundary"),
    keys.get("late fire (22:05 IST)"),
  ];
  check(
    boundaryKey !== beforeKey,
    `one second before the boundary resolves to the PREVIOUS window (${beforeKey} vs ${boundaryKey})`,
  );
  check(
    lateKey !== undefined && lateKey === boundaryKey,
    `a late fire produces an identical key (${lateKey} === ${boundaryKey})`,
  );

  /* 3 — `stale` ---------------------------------------------------------- */
  console.log("\nFreshness");
  const staleRun = await get(`/api/digest/day?${atQuery("2026-09-19T23:30:00.000Z")}`);
  check(staleRun.body?.stale === true, "7 h after the boundary the window is stale");
  const freshRun = await get(`/api/digest/day?${atQuery("2026-09-18T16:30:00.000Z")}`);
  check(freshRun.body?.stale === false, "on the boundary the window is fresh");
  note("a stale window is never posted — the 22:15 fallback push is what surfaces a missed night");

  /* 4 — `?at` validation and `?dryRun` ----------------------------------- */
  console.log("\nParameter handling");
  const noOffset = await get(`/api/digest/day?${atQuery("2026-09-18T16:35:00")}`);
  check(noOffset.status === 400, `?at without an offset → 400 (got ${noOffset.status})`);
  const junkAt = await get(`/api/digest/day?${atQuery("yesterday")}`);
  check(junkAt.status === 400, `?at=garbage → 400 (got ${junkAt.status})`);

  const dryRun = await get(`/api/digest/day?${atQuery("2026-09-18T16:30:00.000Z")}&dryRun=1`);
  check(dryRun.status === 200, `?dryRun=1 is accepted → 200 (got ${dryRun.status})`);
  check(
    dryRun.body?.text === freshRun.body?.text && dryRun.body?.window?.key === freshRun.body?.window?.key,
    "?dryRun=1 changes nothing — the route never writes",
  );

  /* 5 — POST argument handling (nothing is written) ---------------------- */
  console.log("\nPOST (write-free paths only)");
  // The key every writing-path probe targets. It comes from the server's own
  // current window — client-computed only as a fallback — so it is guaranteed
  // to have ENDED. A hard-coded date would be a future window on the day this
  // runs, and the hardened validator would reject it for the wrong reason.
  const realKey = live.body?.window?.key ?? expectedWindow(Date.now()).key;

  const badKey = await post({ windowKey: "not-a-window-key", status: "sent" });
  check(badKey.status === 400, `POST with a malformed windowKey → 400 (got ${badKey.status})`);

  // Semantic key checks. Sent with `status: "failed"` on purpose: against a
  // deployment that predates the hardening these keys would be ACCEPTED, and
  // "failed" is the one status that records nothing — so probing an old build
  // cannot leave a junk marker behind. A `sent` probe could.
  const impossibleDate = await post({ windowKey: "9999-99-99..9999-99-99", status: "failed" });
  check(impossibleDate.status === 400, `POST with an impossible date → 400 (got ${impossibleDate.status})`);

  const nonAdjacent = await post({ windowKey: "2026-01-01..2026-12-31", status: "failed" });
  check(nonAdjacent.status === 400, `POST with a range that is not 24 h → 400 (got ${nonAdjacent.status})`);

  // Derived, not hard-coded, so this stays a future window however long the
  // script lives. Marking a window that has not ended would suppress that
  // night's post AND its fallback, because both treat a marker as "handled".
  const futureKey = expectedWindow(Date.now() + 48 * 60 * 60 * 1000).key;
  const future = await post({ windowKey: futureKey, status: "failed" });
  check(future.status === 400, `POST with a window that has not ended (${futureKey}) → 400 (got ${future.status})`);

  const badStatus = await post({ windowKey: realKey, status: "bogus" });
  check(badStatus.status === 400, `POST with an unknown status → 400 (got ${badStatus.status})`);

  const badJson = await post("{not json");
  check(badJson.status === 400, `POST with a non-JSON body → 400 (got ${badJson.status})`);

  // Read and re-read the SAME window the failed POST targets, so the no-write
  // assertion below is about the window that was actually touched.
  const before = await get("/api/digest/day");
  const failed = await post({
    windowKey: realKey,
    status: "failed",
    // Lands in the deployment's log next to the route's own warn line.
    detail: "verify:digest-feed — intentional, not a real send failure",
  });
  check(failed.status === 200, `POST status=failed → 200 (got ${failed.status})`);
  check(failed.body?.recorded === false, "POST status=failed records nothing");
  check(failed.body?.sentAt === null, "POST status=failed returns sentAt: null");

  const after = await get("/api/digest/day");
  check(
    after.body?.window?.key === before.body?.window?.key,
    "the window did not roll over between the two reads",
  );
  check(
    after.body?.alreadySent === before.body?.alreadySent && after.body?.sentAt === before.body?.sentAt,
    "a failed send leaves the window unmarked — which is what lets the fallback push fire",
  );

  note("POST status=sent is NOT exercised: it would write the send marker, suppress tonight's post");
  note("and disable the 22:15 fallback, with no way to undo it from this script. The agent's first");
  note("real post confirms that path — see docs/PLAN_WHATSAPP_AGENT_TERMUX.md §7.");

  /* report --------------------------------------------------------------- */
  if (failures > 0) {
    console.error(`\n✗ Digest feed verification FAILED (${failures} check(s) failed) at ${BASE}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `\n✓ Digest feed OK — ${BASE} refuses unauthenticated callers, computes the 22:00 IST window ` +
      "correctly at every pinned instant, and builds a message that honours §5.4.6.",
  );
}

main().catch((e) => {
  console.error(e);
  // Deliberately NOT `process.exit(1)`. By the time a throw reaches here an
  // HTTP socket is usually still mid-close, and exiting out from under it trips
  // a libuv assertion on Windows — `Assertion failed: !(handle->flags &
  // UV_HANDLE_CLOSING)` — which aborts with a meaningless exit code (127)
  // instead of the 1 the caller expects. Setting the code and letting the event
  // loop drain exits cleanly.
  process.exitCode = 1;
});
