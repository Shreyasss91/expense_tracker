import { NextResponse } from "next/server";
import { dispatchNotifications } from "@/lib/notifications";
import { timingSafeStringEqual } from "@/lib/secure-compare";

export const dynamic = "force-dynamic";

/**
 * §2.11 — the daily push driver. Runs on a Vercel cron (vercel.json, 09:00
 * UTC) and pushes whatever is due: budget pacing at >= 80% and the review
 * queue. The dispatch function itself enforces the once-per-day-per-key gate,
 * so even a mis-set schedule that fires twice in a day won't double-ping.
 *
 * `?dryRun=1` reports what would be sent without contacting any push service
 * — handy for a manual smoke test that doesn't need real subscriptions.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  // §1.8: constant-time compare of the bearer token (no timing leak of secret).
  if (!secret || !authorization || !timingSafeStringEqual(authorization, `Bearer ${secret}`)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  if (dryRun) {
    const { computeNotifications } = await import("@/lib/notifications");
    const due = await computeNotifications();
    return NextResponse.json({ ok: true, dryRun: true, due });
  }

  try {
    const result = await dispatchNotifications();
    return NextResponse.json(result, { status: result.ok ? 200 : (result.status ?? 500) });
  } catch (error) {
    console.error("Push dispatch failed", error);
    return NextResponse.json({ ok: false, error: "Dispatch failed" }, { status: 500 });
  }
}
