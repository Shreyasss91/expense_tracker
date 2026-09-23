"use server";

import { auth } from "@/auth";
import { revalidatePath } from "@/lib/cache-refresh";
import { todayInIST } from "@/lib/dates";
import { digestPeriodForDate, monthPeriod, monthToDatePeriod, normalizeWhatsAppPhone } from "@/lib/digest";
import { setWhatsAppDigestConfig, getWhatsAppDigestConfig, buildWhatsAppDigestLink, recordWhatsAppDigestSent } from "@/lib/whatsapp-digest";
import { sendTelegramDigest } from "@/lib/telegram-digest";
import { setFeedEnabled as writeFeedEnabled } from "@/lib/ledger-feed";
import { sendDigestSchema, setFeedEnabledSchema, whatsAppDigestConfigSchema } from "@/lib/validations";
import { z } from "zod";

/**
 * Digest settings + manual digest sends (§19 / owner schedule), plus the
 * daily ledger-change feed's master switch (§5.6 of
 * docs/specs/daily-ledger-whatsapp-feed.md).
 *
 * Manual sends are deliberately NOT idempotent — the user clicked "send",
 * so re-sending is their intent. The automatic cron path (per-period
 * markers) lives in the cron route via telegram-digest/whatsapp-digest.
 */

/** Save the recipient number + auto-digest toggle. Returns the normalized number. */
export async function saveWhatsAppDigest(raw: z.infer<typeof whatsAppDigestConfigSchema>) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Unauthorized" };
  const parsed = whatsAppDigestConfigSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid settings" };

  const phone = normalizeWhatsAppPhone(parsed.data.phone);
  if (!phone) return { ok: false as const, error: "Enter a valid mobile number (10–15 digits)" };

  await setWhatsAppDigestConfig(phone, parsed.data.enabled);

  revalidatePath("/settings");
  revalidatePath("/");
  return { ok: true as const, phone };
}

/**
 * The daily ledger-change feed's master switch (§5.6).
 *
 * Off silences **both** the nightly post and the 22:15 fallback ping, which is
 * the point: the owner switching the feed off is a decision, not a failure, so
 * nothing should nag about it. The endpoint and the cron both read this key
 * live on every run, so no deploy or phone edit is needed either way.
 */
export async function saveFeedEnabled(raw: z.infer<typeof setFeedEnabledSchema>) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Unauthorized" };
  const parsed = setFeedEnabledSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid setting" };

  await writeFeedEnabled(parsed.data.enabled);

  revalidatePath("/settings");
  revalidatePath("/");
  return { ok: true as const };
}

/**
 * Manual digest send.
 *   - telegram: posts immediately via the bot (no marker — always allowed).
 *   - whatsapp: returns the wa.me Click-to-Chat link; the client opens it and
 *     the household taps Send in WhatsApp.
 * Period: "month" (pick any yyyy-MM) or "mtd" (1st of this month → today).
 */
export async function sendDigestManual(raw: z.infer<typeof sendDigestSchema>) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Unauthorized" };
  const parsed = sendDigestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid send request" };

  let period;
  if (parsed.data.period === "ready") {
    const due = digestPeriodForDate(todayInIST());
    if (!due) return { ok: false as const, status: 400, error: "No digest is due today" };
    period = due;
  } else if (parsed.data.period === "month") {
    period = parsed.data.month ? monthPeriod(parsed.data.month) : monthPeriod(todayInIST().slice(0, 7));
  } else {
    period = monthToDatePeriod(todayInIST());
  }

  if (parsed.data.channel === "telegram") {
    return await sendTelegramDigest(period);
  }

  const config = await getWhatsAppDigestConfig();
  if (!config.phone) {
    return { ok: false as const, status: 503, error: "Set a WhatsApp number in Settings first" };
  }
  const url = await buildWhatsAppDigestLink(period, config.phone);
  // A manual send opens the wa.me draft — record it as the last WhatsApp send.
  await recordWhatsAppDigestSent(period);
  return { ok: true as const, url, period };
}