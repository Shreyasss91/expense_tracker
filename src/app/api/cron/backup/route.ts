import { NextResponse } from "next/server";
import { sendMonthlyBackup } from "@/lib/backup-delivery";
import { timingSafeStringEqual } from "@/lib/secure-compare";

export const dynamic = "force-dynamic";

/**
 * §2.10 — monthly backup delivery. Scheduled in vercel.json for the 1st at
 * 04:00 IST (one hour after the Telegram digest, so a failure here is easy to
 * tell apart from a failure there).
 *
 * `?month=YYYY-MM` overrides the default (the previous month) for a manual
 * re-send; a month already marked sent is answered `already_sent` and skipped.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  // §1.8: constant-time compare of the bearer token (no timing leak of secret).
  if (!secret || !authorization || !timingSafeStringEqual(authorization, `Bearer ${secret}`)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const month = new URL(request.url).searchParams.get("month") ?? undefined;
  try {
    const result = await sendMonthlyBackup(month);
    return NextResponse.json(result, { status: result.ok ? 200 : (result.status ?? 500) });
  } catch (error) {
    console.error("Monthly backup failed", error);
    return NextResponse.json({ ok: false, error: "Backup failed" }, { status: 500 });
  }
}
