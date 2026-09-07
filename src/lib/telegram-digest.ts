import "server-only";

import { db } from "@/db";
import { getAppSetting, setAppSetting } from "@/db/app-settings-mutations";
import { buildTelegramDigestMessage, getDigestData, type DigestPeriod } from "@/lib/digest";

/**
 * §17 (Amendments 17/19) — Telegram delivery for the shared digest engine.
 *
 * One idempotent path for the cron (per-period marker in app_settings, same
 * pattern as the old monthly digest and the backup job) and one plain path for
 * manual "send now" clicks (user-initiated = always allowed to re-send).
 *
 * Env-gated like the backup delivery: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID,
 * or the whole feature degrades to a clear "not configured" 503.
 */

const SENT_KEY_PREFIX = "telegram_digest_sent:";

export type TelegramSendResult =
  | { ok: true; sent: boolean; reason?: "already_sent"; period: DigestPeriod }
  | { ok: false; status: number; error: string };

/** Build + send one digest message to the configured Telegram chat. No marker. */
export async function sendTelegramDigest(period: DigestPeriod): Promise<TelegramSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { ok: false as const, status: 503, error: "Telegram is not configured (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)" };
  }

  const message = buildTelegramDigestMessage({ ...(await getDigestData(period.start, period.end)), label: period.label });
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML", disable_web_page_preview: true }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null) as { ok?: boolean } | null;
  if (!response.ok || body?.ok !== true) {
    return { ok: false as const, status: 502, error: `Telegram returned HTTP ${response.status}` };
  }
  return { ok: true as const, sent: true, period };
}

/** Cron path — skip silently when this period already went out on Telegram. */
export async function sendTelegramDigestIdempotent(period: DigestPeriod): Promise<TelegramSendResult> {
  const sentKey = `${SENT_KEY_PREFIX}${period.key}`;
  if (await getAppSetting(db, sentKey)) {
    return { ok: true as const, sent: false, reason: "already_sent" as const, period };
  }
  const result = await sendTelegramDigest(period);
  if (result.ok) {
    await setAppSetting(db, sentKey, new Date().toISOString());
  }
  return result;
}