import { NextResponse } from "next/server";
import { sendMonthlyTelegramDigest } from "@/lib/telegram-digest";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const month = new URL(request.url).searchParams.get("month") ?? undefined;
  try {
    const result = await sendMonthlyTelegramDigest(month);
    return NextResponse.json(result, { status: result.ok ? 200 : result.status });
  } catch (error) {
    console.error("Telegram digest failed", error);
    return NextResponse.json({ ok: false, error: "Digest failed" }, { status: 500 });
  }
}
