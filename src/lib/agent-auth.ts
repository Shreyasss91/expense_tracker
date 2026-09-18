import { RateLimiter, timingSafeStringEqual } from "./secure-compare";

/**
 * Bearer-token authentication for the **agent-facing** routes
 * (`/api/digest/day`), called by an external client with no session cookie.
 *
 * This lives in its own module, free of `server-only` and of any DB import, for
 * one reason: it is security logic, and it should be testable. The route
 * handler's job is reduced to reading headers and mapping the decision below to
 * a response.
 */

/**
 * Failed-attempt budget per client, mirroring the password login's use of
 * `RateLimiter` (§1.8).
 *
 * Deliberately loose: the agent's retry ladder makes at most **five** attempts
 * per night, so no legitimate run can reach this within the window. Being locked
 * out by your own typo is a worse failure than an extra handful of attempts,
 * and the throttle exists to stop automated grinding of a 64-character hex
 * token — not to police a household's phone.
 *
 * Best-effort by nature: serverless instances do not share the map and a cold
 * start clears it. Vercel's own request throttling is the backstop.
 */
export const AGENT_AUTH_FAIL_LIMIT = 20;
export const AGENT_AUTH_FAIL_WINDOW_MS = 5 * 60 * 1000;

/**
 * `Bearer` followed by whitespace. The `i` flag is the point: RFC 7235 defines
 * the auth scheme as **case-insensitive**, so a client sending `bearer <token>`
 * is correct and was previously being refused.
 *
 * The token itself is still compared in constant time — the scheme is not a
 * secret, so matching it with a regex leaks nothing.
 */
const BEARER_PREFIX_RE = /^Bearer[ \t]+/i;

export type AgentAuthResult =
  | { ok: true }
  | { ok: false; status: 503; error: string }
  | { ok: false; status: 401; error: string }
  | { ok: false; status: 429; error: string };

/**
 * The throttle key: the client address, so one noisy caller cannot lock out
 * another.
 *
 * Vercel sets `x-forwarded-for`, whose left-most entry is the client. The
 * `"unknown"` fallback shares a single budget among all such callers, which is
 * the conservative direction — under local development or an unexpected proxy it
 * throttles more, never less.
 */
export function clientKeyFrom(forwardedFor: string | null, realIp: string | null): string {
  const first = forwardedFor?.split(",")[0]?.trim();
  return first || realIp?.trim() || "unknown";
}

/**
 * Decide whether a request may proceed.
 *
 * Order matters, and every step is deliberate:
 *
 * 1. **Unconfigured server ⇒ `503`**, checked *before* the throttle. "Not
 *    configured" and "wrong token" are different diagnoses and the agent's log
 *    has to tell them apart; a throttled caller on an unconfigured deployment
 *    should still learn the more useful fact.
 * 2. **Already blocked ⇒ `429`**, before any comparison, so a blocked caller
 *    cannot keep using the endpoint as a comparison oracle.
 * 3. **Nothing presented ⇒ `401` without recording.** See below.
 * 4. **Constant-time token compare** (`timingSafeStringEqual`, SPEC §1.8 /
 *    CWE-208). Never `===` on a secret. Only the *token* is compared — the
 *    scheme is stripped by the regex above.
 * 5. **A presented-but-wrong credential is recorded**, which is what eventually
 *    produces step 2.
 *
 * **Why step 3 does not count.** A request with no `Authorization` header is not
 * a guess — there is nothing in it to compare against the secret, so it cannot
 * learn anything from a 401. Counting it would mean anything that merely *pokes*
 * the endpoint unauthenticated (a health check, a browser prefetch, the live
 * verifier's own anonymous probes) could burn the budget and lock out the real
 * agent. Only a credential that was actually **presented and rejected** is a
 * failed attempt — which is also what the password login counts.
 *
 * A success deliberately does **not** clear the caller's failure history — that
 * would need a `reset()` on the shared `RateLimiter`, and there is nothing to
 * gain: the only party who can succeed already holds the token, and the budget
 * expires on its own.
 */
export function checkAgentAuth({
  authorization,
  expected,
  clientKey,
  limiter,
}: {
  authorization: string | null;
  expected: string | undefined;
  clientKey: string;
  limiter: RateLimiter;
}): AgentAuthResult {
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: "DIGEST_AGENT_TOKEN is not configured on the server",
    };
  }

  if (limiter.isBlocked(clientKey)) {
    return { ok: false, status: 429, error: "Too many failed attempts" };
  }

  const header = authorization ?? "";
  if (header === "") {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const prefix = BEARER_PREFIX_RE.exec(header);
  if (!prefix || !timingSafeStringEqual(header.slice(prefix[0].length), expected)) {
    limiter.record(clientKey);
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true };
}
