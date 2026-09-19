import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { refreshAfterWrite } from "@/lib/cache-refresh";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { getAppSetting, setAppSetting } from "@/db/app-settings-mutations";
import { timingSafeStringEqual } from "@/lib/secure-compare";
import { isPushConfigured } from "@/lib/web-push";
import { deliverPushToAllDevices } from "@/lib/push-dispatch";
import {
  feedFallbackPingedKey,
  feedSentKey,
  feedWindowForInstant,
  isFeedEnabled,
} from "@/lib/ledger-feed";

export const dynamic = "force-dynamic";

/**
 * The daily feed's safety net — 22:15 IST, fifteen minutes after the phone is
 * supposed to post. It pings the household's devices **only** when no send is
 * recorded for the window, so a phone that was off, rebooting or had Termux
 * killed stops being a silent failure.
 *
 * A **separate cron job**, not a second run of `/api/cron/digest`: Vercel's
 * Hobby plan allows any given job at most one run per day (a half-hourly
 * schedule is rejected at deploy time) while permitting up to 100 jobs per
 * project. Do not "simplify" the two together.
 *
 * At most one nag per window, ever — the marker below is written even when
 * nobody is subscribed.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  // §1.8 — constant-time compare of the bearer token.
  if (!secret || !authorization || !timingSafeStringEqual(authorization, `Bearer ${secret}`)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const window = feedWindowForInstant(new Date());

  try {
    // A deliberately disabled feed must not generate noise.
    if (!(await isFeedEnabled())) {
      return NextResponse.json({ ok: true, date: window.endDateIst, skipped: "disabled" });
    }

    if (await getAppSetting(db, feedSentKey(window.key))) {
      return NextResponse.json({ ok: true, date: window.endDateIst, skipped: "already_sent" });
    }

    const pingKey = feedFallbackPingedKey(window.key);
    if (await getAppSetting(db, pingKey)) {
      return NextResponse.json({ ok: true, date: window.endDateIst, skipped: "already_pinged" });
    }

    if (!isPushConfigured()) {
      return NextResponse.json(
        {
          ok: false,
          date: window.endDateIst,
          status: 503,
          error: "Web Push is not configured (set VAPID_* env vars)",
        },
        { status: 503 },
      );
    }

    const subscribers = await db.select().from(pushSubscriptions);
    // Zero subscribed devices is a success with sent: 0, not an error.
    const { sent, failed, stale } = await deliverPushToAllDevices(subscribers, {
      title: "Family Ledger · digest not posted",
      body: "The 10 PM ledger post hasn't gone out. Tap to send it manually.",
      // The dashboard, never a deep link that can go stale.
      url: "/",
    });

    // At most once per window, whether or not any device accepted it.
    await setAppSetting(db, pingKey, new Date().toISOString());
    // The ping marker is written; a refresh that fails must not mark the run
    // failed, or Vercel alerts on a nag that was in fact delivered
    // (see `refreshAfterWrite`).
    refreshAfterWrite(`digest fallback ping ${window.key}`, () => revalidatePath("/"));

    return NextResponse.json({ ok: true, date: window.endDateIst, sent, failed, stale });
  } catch (error) {
    console.error("Digest fallback cron failed", error);
    return NextResponse.json({ ok: false, error: "Fallback push failed" }, { status: 500 });
  }
}
