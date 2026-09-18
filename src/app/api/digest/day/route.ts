import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { timingSafeStringEqual } from "@/lib/secure-compare";
import {
  buildLedgerFeedMessage,
  FEED_KEY_RE,
  feedWindowForInstant,
  getFeedSentAt,
  getLedgerFeed,
  isFeedEnabled,
  recordFeedSent,
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

/** Returns a response to send back when the caller is not the agent, else null. */
function denyUnauthorized(request: Request): NextResponse | null {
  const expected = process.env.DIGEST_AGENT_TOKEN;
  // "Not configured" and "wrong token" are different diagnoses, and the agent's
  // log has to be able to tell them apart: 503 vs 401.
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "DIGEST_AGENT_TOKEN is not configured on the server" },
      { status: 503 },
    );
  }
  const authorization = request.headers.get("authorization");
  // §1.8 — constant-time compare. Never `===` on a secret (CWE-208).
  if (!authorization || !timingSafeStringEqual(authorization, `Bearer ${expected}`)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
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
  if (!FEED_KEY_RE.test(windowKey)) {
    return NextResponse.json({ ok: false, error: "Invalid windowKey" }, { status: 400 });
  }
  if (payload.status !== "sent" && payload.status !== "failed") {
    return NextResponse.json({ ok: false, error: 'status must be "sent" or "failed"' }, { status: 400 });
  }

  try {
    // A failed post deliberately writes NOTHING: leaving the window unmarked is
    // exactly what lets the 22:15 fallback push fire.
    if (payload.status === "failed") {
      console.warn(
        "digest/day reported a failed send",
        windowKey,
        typeof payload.detail === "string" ? payload.detail : "",
      );
      return NextResponse.json({ ok: true, recorded: false, sentAt: null });
    }

    const sentAt = await recordFeedSent(windowKey);
    // The digest cards render the marker, so the dashboard must re-render.
    revalidatePath("/");
    return NextResponse.json({ ok: true, recorded: true, sentAt });
  } catch (error) {
    console.error("digest/day POST failed", error);
    return NextResponse.json({ ok: false, error: "Could not record the send" }, { status: 500 });
  }
}
