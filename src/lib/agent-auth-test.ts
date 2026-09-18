/**
 * Agent bearer-auth tests — `npm run test:agent-auth`.
 *
 * This is the only authentication between the internet and the ledger feed's
 * read endpoint, so it is tested directly rather than through a route handler:
 * `checkAgentAuth` takes its limiter as an argument and imports neither
 * `server-only` nor the DB, which makes the whole decision — including the
 * throttle — reachable from here.
 *
 * The `RateLimiter` itself had no coverage before this file, despite already
 * guarding the master-password login.
 */
import { RateLimiter } from "./secure-compare";
import {
  AGENT_AUTH_FAIL_LIMIT,
  AGENT_AUTH_FAIL_WINDOW_MS,
  checkAgentAuth,
  clientKeyFrom,
} from "./agent-auth";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

const TOKEN = "a".repeat(64);
/** A wrong token of the SAME length, so nothing can pass on a length check. */
const WRONG = "b".repeat(64);

const freshLimiter = (max = AGENT_AUTH_FAIL_LIMIT) => new RateLimiter(max, AGENT_AUTH_FAIL_WINDOW_MS);
function auth(
  authorization: string | null,
  { limiter = freshLimiter(), expected = TOKEN as string | undefined, clientKey = "1.2.3.4" } = {},
) {
  return checkAgentAuth({ authorization, expected, clientKey, limiter });
}

/* ------------------------------------------------------------ the happy path -- */

console.log("\nBearer authentication");

check(auth(`Bearer ${TOKEN}`).ok === true, "the correct token is accepted");
check(
  JSON.stringify(auth(`Bearer ${TOKEN}`)) === '{"ok":true}',
  "the success result carries no status or error — the route maps only the failure shapes",
);
check(
  auth(`Bearer ${TOKEN}`).ok === true && auth(`Bearer ${TOKEN}`).ok === true,
  "it is repeatable: a second identical call is accepted too",
);

/* ------------------------------------------- the scheme is case-insensitive --- */

console.log("\nScheme case (RFC 7235)");

for (const scheme of ["bearer", "BEARER", "BeArEr"]) {
  check(auth(`${scheme} ${TOKEN}`).ok === true, `\`${scheme} <token>\` is accepted, not just \`Bearer\``);
}

/* --------------------------------------------------------------- rejections -- */

console.log("\nRejections");

const rejects = (label: string, authorization: string | null, expectedStatus = 401) => {
  const result = auth(authorization);
  check(
    !result.ok && result.status === expectedStatus,
    `${label} (got ${result.ok ? "accepted" : result.status})`,
  );
};

rejects("a missing Authorization header", null);
rejects("an empty Authorization header", "");
rejects("a wrong token of the same length", `Bearer ${WRONG}`);
rejects("a truncated token", `Bearer ${TOKEN.slice(0, 32)}`);
rejects("a token with a trailing space", `Bearer ${TOKEN} `);
rejects("no space after the scheme", `Bearer${TOKEN}`);
rejects("the scheme alone", "Bearer");
rejects("a different scheme carrying the right token", `Basic ${TOKEN}`);
rejects("a lowercase scheme with a wrong token", `bearer ${WRONG}`);
rejects("a token with no scheme at all", TOKEN);

/* ------------------------------------------------------ not-configured = 503 -- */

console.log("\nUnconfigured server (503, not 401)");

// Called directly, NOT through the `auth()` helper: an explicit
// `{ expected: undefined }` would re-trigger the helper's destructuring default
// and silently test the configured path instead. That mistake is exactly what
// this pair of assertions exists to catch.
const unconfigured = checkAgentAuth({
  authorization: `Bearer ${TOKEN}`,
  expected: undefined,
  clientKey: "1.2.3.4",
  limiter: freshLimiter(),
});
check(
  !unconfigured.ok && unconfigured.status === 503,
  "\"the deployment has no secret\" is told apart from \"this client has the wrong secret\"",
);
const unconfiguredEmpty = auth(`Bearer ${TOKEN}`, { expected: "" });
check(
  !unconfiguredEmpty.ok && unconfiguredEmpty.status === 503,
  "an empty string is treated as unconfigured, not as an empty secret",
);

/* -------------------------------------------------------------- the throttle -- */

console.log("\nFailed-attempt throttle");

{
  const limiter = freshLimiter(2);
  const first = auth(`Bearer ${WRONG}`, { limiter });
  const second = auth(`Bearer ${WRONG}`, { limiter });
  const third = auth(`Bearer ${WRONG}`, { limiter });
  check(
    !first.ok && first.status === 401 && !second.ok && second.status === 401,
    "failures below the budget are plain 401s",
  );
  check(!third.ok && third.status === 429, "the attempt past the budget is 429, not another 401");
}
{
  const limiter = freshLimiter(1);
  auth(`Bearer ${WRONG}`, { limiter });
  const blocked = auth(`Bearer ${TOKEN}`, { limiter });
  check(
    !blocked.ok && blocked.status === 429,
    "once blocked, even the CORRECT token is refused — the block is checked before the compare",
  );
}
{
  const limiter = freshLimiter(1);
  auth(`Bearer ${WRONG}`, { limiter, clientKey: "9.9.9.9" });
  check(
    auth(`Bearer ${TOKEN}`, { limiter, clientKey: "1.2.3.4" }).ok === true,
    "one client's block does not lock out another",
  );
}
{
  const limiter = freshLimiter(1);
  check(
    auth(`Bearer ${TOKEN}`, { limiter }).ok === true && auth(`Bearer ${TOKEN}`, { limiter }).ok === true,
    "a successful call never consumes budget — the agent cannot throttle itself",
  );
}
{
  // The design decision that keeps the throttle from becoming a denial of
  // service against the agent: an unauthenticated request presents nothing to
  // compare, so it is refused WITHOUT being counted.
  const limiter = freshLimiter(1);
  auth(null, { limiter });
  auth(null, { limiter });
  auth("", { limiter });
  const stillCounts = auth(`Bearer ${WRONG}`, { limiter });
  check(
    !stillCounts.ok && stillCounts.status === 401,
    "anonymous requests are refused but never consume budget (they are not guesses)",
  );
  const nowBlocked = auth(`Bearer ${WRONG}`, { limiter });
  check(
    !nowBlocked.ok && nowBlocked.status === 429,
    "...so only a presented-and-rejected credential reaches the budget",
  );
}
{
  // 503 is decided before the throttle, so an unconfigured deployment says so
  // even to a caller that has exhausted its budget. Direct call for the same
  // reason as above: `undefined` must reach the function, not a default.
  const limiter = freshLimiter(1);
  auth(`Bearer ${WRONG}`, { limiter });
  const result = checkAgentAuth({
    authorization: `Bearer ${TOKEN}`,
    expected: undefined,
    clientKey: "1.2.3.4",
    limiter,
  });
  check(
    !result.ok && result.status === 503,
    "unconfigured (503) is reported ahead of being throttled (429)",
  );
}

/* ------------------------------------------------------------- the limiter ---- */

console.log("\nRateLimiter (shared primitive)");

{
  const plain = new RateLimiter(2, AGENT_AUTH_FAIL_WINDOW_MS);
  check(plain.isBlocked("k") === false, "a fresh key is not blocked");
  plain.record("k");
  plain.record("k");
  check(plain.isBlocked("k") === true, "the key is blocked once the budget is reached");
  check(plain.isBlocked("other") === false, "other keys are untouched");
  check(AGENT_AUTH_FAIL_LIMIT === 20, "the endpoint's budget is 20, four times the ladder's 5 attempts");
}
{
  // A 1 ms window, then a short synchronous spin — no top-level await, matching
  // the rest of the suites. The point is that a block LIFTS, so one bad night
  // cannot lock the agent out until someone notices.
  const brief = new RateLimiter(1, 1);
  brief.record("k");
  const blockedNow = brief.isBlocked("k");
  const until = Date.now() + 5;
  while (Date.now() < until) {
    /* spin past the window */
  }
  check(blockedNow === true && brief.isBlocked("k") === false, "the block expires with its window");
}

/* ------------------------------------------------------------- client key ----- */

console.log("\nThrottle key");

check(clientKeyFrom("203.0.113.7", null) === "203.0.113.7", "a bare x-forwarded-for is the key");
check(
  clientKeyFrom("203.0.113.7, 70.41.3.18, 150.172.238.178", null) === "203.0.113.7",
  "only the LEFT-most proxy entry is used — the client, not the last hop",
);
check(clientKeyFrom(null, "198.51.100.4") === "198.51.100.4", "x-real-ip is the fallback");
check(clientKeyFrom(null, null) === "unknown", "neither header present → one shared bucket");
check(clientKeyFrom("  ", "  ") === "unknown", "blank headers are treated as absent");
check(clientKeyFrom(" 203.0.113.7 ", null) === "203.0.113.7", "whitespace is trimmed");

console.log(
  failures === 0 ? "\nAll agent-auth checks passed.\n" : `\n${failures} agent-auth check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
