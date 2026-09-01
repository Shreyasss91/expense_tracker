import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison to avoid leaking the correct password or
 * CRON_SECRET via response timing (CWE-208). Returns false immediately when
 * the lengths differ (an unavoidable, negligible length hint), then compares
 * byte-for-byte in constant time once lengths match.
 *
 * Do NOT replace this with `a === b` — that short-circuits on the first
 * differing byte and is trivially timing-distinguishable.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
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
