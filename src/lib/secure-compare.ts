/**
 * Constant-time string comparison to avoid leaking the correct password or
 * CRON_SECRET via response timing (CWE-208). Returns false immediately when
 * the lengths differ (an unavoidable, negligible length hint), then compares
 * byte-for-byte in constant time once lengths match.
 *
 * Do NOT replace this with `a === b` — that short-circuits on the first
 * differing byte and is trivially timing-distinguishable.
 *
 * §1.8 fix-up (2 Sep 2026): this module previously imported
 * `timingSafeEqual` from `node:crypto`. `auth.config.ts` is imported by BOTH
 * the Node server (src/auth.ts) and `src/middleware.ts`, and middleware is
 * compiled for the Edge runtime, where webpack cannot bundle `node:` URI
 * imports — `next build` failed on the middleware chunk (pre-existing since
 * the §1.8 pass; surfaced as red CI on §2.9). Web Crypto has no
 * timingSafeEqual, so the portable form is TextEncoder bytes + an XOR
 * accumulator loop, which is what this now is. TextEncoder is available in
 * both the Edge runtime and Node ≥ 18.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i += 1) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/**
 * Keyed fingerprint (HMAC-SHA-256) of the family master password.
 *
 * §3.1 session revocation: the session cookie is a stateless JWT signed with
 * AUTH_SECRET, so changing `FAMILY_MASTER_PASSWORD` does not by itself
 * invalidate an already-issued cookie — the signature still verifies, and
 * `updateAge` rolls an active holder forward indefinitely (§1.8). The auth
 * callbacks therefore pin this fingerprint into the token at sign-in and
 * re-derive it on every request, so a password change retires every session
 * that predates it.
 *
 * AUTH_SECRET is the HMAC key rather than the message: the fingerprint travels
 * inside the token, so it must not be reversible (or brute-forceable) back to
 * the password even if a token is ever exposed.
 *
 * Same Edge constraint as `timingSafeStringEqual` above — `auth.config.ts` is
 * bundled for the Edge runtime by `src/middleware.ts`, so this must use Web
 * Crypto and never `node:crypto`. That makes it async (`subtle` has no sync
 * API), which both auth callbacks accommodate.
 */
export async function masterPasswordFingerprint(): Promise<string> {
  const key = process.env.AUTH_SECRET;
  const password = process.env.FAMILY_MASTER_PASSWORD;
  // Both are required (next-auth refuses to run without AUTH_SECRET, and §3.1
  // requires the password). An absent one is a deploy misconfiguration: fail
  // closed to a sentinel rather than throwing — Web Crypto rejects a
  // zero-length HMAC key with a DataError.
  if (!key || !password) return "unconfigured";

  const encoder = new TextEncoder();
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(password));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Best-effort in-memory rate limiter.
 *
 * NOTE: serverless cold starts reset the map, so this is defence-in-depth
 * rather than a hard guarantee — pair it with the platform's own request
 * throttling (e.g. Vercel's) for production-grade protection. It still raises
 * the cost of a brute-force attempt from a single instance's perspective.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly maxAttempts: number,
    private readonly windowMs: number,
  ) {}

  /** True if `key` has already exceeded the attempt budget in the window. */
  isBlocked(key: string): boolean {
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    this.hits.set(key, list);
    return list.length >= this.maxAttempts;
  }

  /** Records one attempt for `key` (call after a failed auth check). */
  record(key: string): void {
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    list.push(now);
    this.hits.set(key, list);
  }
}
