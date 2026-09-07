import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { format, isValid, parse } from "date-fns";
import { digestPeriodForDate } from "@/lib/digest";
import { sendTelegramDigestIdempotent } from "@/lib/telegram-digest";
import { getWhatsAppDigestConfig, pingDigestReady } from "@/lib/whatsapp-digest";
import { todayInIST } from "@/lib/dates";
import { timingSafeStringEqual } from "@/lib/secure-compare";

export const dynamic = "force-dynamic";

/**
 * The digest driver — replaces the old 1st-of-month telegram-digest cron with
 * the owner's schedule: the 7th, 14th, 21st, 28th (weekly) and the last day
 * of the month (monthly), at 10:00 PM IST.
 *
 * vercel.json runs this daily at 16:30 UTC; the IST day-of-month check
 * decides whether today is a digest day, so a single schedule covers the
 * "last day of the month" without cron's missing last-day-of-month syntax.
 *
 * What happens on a digest day:
 *   - Telegram: the bot auto-sends the digest (idempotent per period).
 *   - WhatsApp: Click-to-Chat can't push, so the cron pings every opted-in
 *     device ("digest ready — tap to send on WhatsApp"); the dashboard
 *     banner renders the actual wa.me link. Ping is idempotent per period.
 *
 * `?date=YYYY-MM-DD` overrides the reference date (manual backfill/test);
 * `?dryRun=1` reports what would fire without sending anything.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  // §1.8: constant-time compare of the bearer token (no timing leak of secret).
  if (!secret || !authorization || !timingSafeStringEqual(authorization, `Bearer ${secret}`)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const dateParam = url.searchParams.get("date");
  let date: string;
  if (dateParam) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return NextResponse.json({ ok: false, error: "Invalid date format (expected YYYY-MM-DD)" }, { status: 400 });
    }
    const parsed = parse(dateParam, "yyyy-MM-dd", new Date());
    // parse() yields an Invalid Date for impossible dates (e.g. 2026-13-99),
    // and format() throws on those — so check isValid before touching it.
    if (!isValid(parsed) || format(parsed, "yyyy-MM-dd") !== dateParam) {
      return NextResponse.json({ ok: false, error: "Invalid calendar date" }, { status: 400 });
    }
    date = dateParam;
  } else {
    date = todayInIST();
  }

  const period = digestPeriodForDate(date);
  if (!period) {
    return NextResponse.json({ ok: true, date, skipped: "not_a_digest_day" });
  }

  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, date, period });
  }

  try {
    const telegram = await sendTelegramDigestIdempotent(period);

    const whatsappConfig = await getWhatsAppDigestConfig();
    const whatsapp =
      whatsappConfig.enabled && whatsappConfig.phone ? await pingDigestReady(period) : { ok: true as const, skipped: "whatsapp_not_configured" };

    // The dashboard banner ("digest ready — send on WhatsApp") derives from
    // today being a digest day, so the page must re-render after a send.
    revalidatePath("/");

    return NextResponse.json({ ok: true, date, period, telegram, whatsapp });
  } catch (error) {
    console.error("Digest cron failed", error);
    return NextResponse.json({ ok: false, error: "Digest failed" }, { status: 500 });
  }
}