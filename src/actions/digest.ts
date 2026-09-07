"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { todayInIST } from "@/lib/dates";
import { digestPeriodForDate, monthPeriod, monthToDatePeriod, normalizeWhatsAppPhone } from "@/lib/digest";
import { setWhatsAppDigestConfig, getWhatsAppDigestConfig, buildWhatsAppDigestLink } from "@/lib/whatsapp-digest";
import { sendTelegramDigest } from "@/lib/telegram-digest";
import { sendDigestSchema, whatsAppDigestConfigSchema } from "@/lib/validations";
import { z } from "zod";

/**
 * WhatsApp digest settings + manual digest sends (§19 / owner schedule).
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
  return { ok: true as const, url, period };
}