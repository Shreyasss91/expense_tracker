import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { refreshAfterWrite } from "@/lib/cache-refresh";
import { RateLimiter } from "@/lib/secure-compare";
import {
  AGENT_AUTH_FAIL_LIMIT,
  AGENT_AUTH_FAIL_WINDOW_MS,
  checkAgentAuth,
  clientKeyFrom,
} from "@/lib/agent-auth";
import {
  buildLedgerFeedMessage,
  feedKeyHasEnded,
  feedWindowForInstant,
  getFeedSentAt,
  getLedgerFeed,
  isFeedEnabled,
  parseFeedKey,
  recordFeedSent,
  sanitizeLogDetail,
} from "@/lib/ledger-feed";

export const dynamic = "force-dynamic";

/**
 * The daily ledger-change feed's read + record endpoints, called by the
 * Termux/Baileys agent on Dad's phone (docs/PLAN_WHATSAPP_AGENT_TERMUX.md).
 *
 *   GET  → the **finished message string**. The format lives on the server, so
 *          the poster holds no formatting logic at all.
 *   POST → records a confirmed send. This is a deliberately **mutating** route
 *          handler: the poster is an external, non-browser client with no
 *          NextAuth session cookie, so a Server Action cannot serve it. The
 *          deviation from SPEC §7 was authorized by the owner on
 *          18 September 2026 (docs/SPEC_DAILY_LEDGER_WHATSAPP_FEED.md §15.1).
 *
 * `src/middleware.ts` excludes every `api` route from its matcher, so this
 * route must authenticate itself — hence the bearer token below, the same
 * pattern the `/api/cron/*` routes use.
 */

/** An ISO 8601 instant WITH an explicit offset — the only `at` shape accepted. */
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * One throttle across both verbs, as the login has one across its attempts. The
 * policy itself lives in `@/lib/agent-auth` so it can be tested without HTTP.
 */
const authFailLimiter = new RateLimiter(AGENT_AUTH_FAIL_LIMIT, AGENT_AUTH_FAIL_WINDOW_MS);

/** Returns a response to send back when the caller is not the agent, else null. */
function denyUnauthorized(request: Request): NextResponse | null {
  const result = checkAgentAuth({
    authorization: request.headers.get("authorization"),
    expected: process.env.DIGEST_AGENT_TOKEN,
    clientKey: clientKeyFrom(request.headers.get("x-forwarded-for"), request.headers.get("x-real-ip")),
    limiter: authFailLimiter,
  });
  if (result.ok) return null;
  return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
}

/**
 * `?at=<instant>` pins "now" (test/backfill only); `?dryRun=1` is accepted for
 * contract compatibility — this route never writes, so it changes nothing.
 */
export async function GET(request: Request) {
  const denial = denyUnauthorized(request);
  if (denial) return denial;

  const atParam = new URL(request.url).searchParams.get("at");
  let now = new Date();
  if (atParam !== null) {
    if (!ISO_INSTANT_RE.test(atParam)) {
      return NextResponse.json(
        { ok: false, error: "Invalid `at` — expected an ISO 8601 instant with an offset" },
        { status: 400 },
      );
    }
    const parsed = new Date(atParam);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ ok: false, error: "Invalid `at` instant" }, { status: 400 });
    }
    now = parsed;
  }

  try {
    const window = feedWindowForInstant(now);
    const [enabled, sentAt] = await Promise.all([isFeedEnabled(), getFeedSentAt(window.key)]);

    let counts = { added: 0, edited: 0, deleted: 0, merges: 0 };
    let empty = false;
    let text: string | null = null;

    // Only query when the answer could be posted — but the full `window` object
    // is returned either way, because the agent logs it on every decision.
    if (enabled && !sentAt) {
      const feed = await getLedgerFeed(window);
      counts = feed.counts;
      empty = feed.empty;
      text = buildLedgerFeedMessage(feed);
    }

    return NextResponse.json({
      ok: true,
      window,
      counts,
      empty,
      disabled: !enabled,
      alreadySent: Boolean(sentAt),
      sentAt,
      // Surfaced at the top level as well as inside `window`, so the agent has
      // one predictable place to look at.
      stale: window.stale,
      text,
    });
  } catch (error) {
    // Never leak a stack or SQL to the caller.
    console.error("digest/day GET failed", error);
    return NextResponse.json({ ok: false, error: "Could not build the ledger feed" }, { status: 500 });
  }
}

/** The agent's confirmation — what makes the Settings card's record and the 22:15 fallback agree. */
export async function POST(request: Request) {
  const denial = denyUnauthorized(request);
  if (denial) return denial;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const windowKey = typeof payload.windowKey === "string" ? payload.windowKey : "";
  // Key validation is deliberately stricter than the key's SHAPE: this body
  // comes from outside the app, and the shape regex alone accepts
  // `9999-99-99..9999-99-99` and ranges that are not 24 h. A marker is
  // permanent, and `getRecentDigestSends()` keeps the newest value per channel,
  // so a junk key would also show up on the Settings card. See `parseFeedKey`.
  const parsedKey = parseFeedKey(windowKey);
  if (!parsedKey) {
    return NextResponse.json({ ok: false, error: "Invalid windowKey" }, { status: 400 });
  }
  // Never record a window that has not ended: the marker would suppress that
  // night's post, and the 22:15 fallback with it, because the fallback also
  // treats an existing marker as "already handled".
  if (!feedKeyHasEnded(parsedKey, new Date())) {
    return NextResponse.json(
      { ok: false, error: "windowKey has not ended yet — refusing to mark a future window as sent" },
      { status: 400 },
    );
  }
  if (payload.status !== "sent" && payload.status !== "failed") {
    return NextResponse.json({ ok: false, error: 'status must be "sent" or "failed"' }, { status: 400 });
  }

  try {
    // A failed post deliberately writes NOTHING: leaving the window unmarked is
    // exactly what lets the 22:15 fallback push fire.
    if (payload.status === "failed") {
      // `detail` is caller-supplied and lands in the server log, so it is
      // flattened and bounded first: newlines would let a caller forge
      // additional log lines, and length was previously unbounded.
      const detail = sanitizeLogDetail(payload.detail);
      console.warn(
        `digest/day reported a failed send window=${windowKey}${detail ? ` detail=${detail}` : ""}`,
      );
      return NextResponse.json({ ok: true, recorded: false, sentAt: null });
    }

    const sentAt = await recordFeedSent(windowKey);
    // The digest cards render the marker, so the dashboard should re-render —
    // but by this line the send IS recorded, so a refresh that fails must not be
    // reported as a failed record (see `refreshAfterWrite`).
    refreshAfterWrite(`digest/day recorded window=${windowKey}`, () => revalidatePath("/"));
    return NextResponse.json({ ok: true, recorded: true, sentAt });
  } catch (error) {
    console.error("digest/day POST failed", error);
    return NextResponse.json({ ok: false, error: "Could not record the send" }, { status: 500 });
  }
}
