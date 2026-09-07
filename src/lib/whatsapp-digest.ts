import "server-only";

import { db } from "@/db";
import { getAppSetting, setAppSetting } from "@/db/app-settings-mutations";
import { pushSubscriptions } from "@/db/schema";
import { formatINR } from "@/lib/money";
import { buildWhatsAppDigestText, buildWhatsAppLink, digestPeriodForDate, DIGEST_SENT_KEY_PREFIX, getDigestData, type DigestPeriod } from "@/lib/digest";
import { inArray } from "drizzle-orm";
import { isPushConfigured, sendWebPush, type SendStatus } from "@/lib/web-push";

/**
 * WhatsApp digest delivery — Click-to-Chat, per the owner's decision.
 *
 * There is no Cloud API and no Meta account: "sending" produces a wa.me link
 * with the digest text pre-filled, and the household taps Send in WhatsApp.
 * That is the deliberate trade-off (free, no template approval) — this module
 * owns everything needed to support it:
 *
 *   - the recipient number lives in Settings (app_settings), not env vars —
 *     the one WhatsApp-specific value the owner wants to edit in-app;
 *   - the daily cron prepares a digest on 7/14/21/28 + month-end and, when
 *     push is set up, pings the household's devices so nobody has to remember
 *     to open the app (idempotent per period, same gate as §2.11);
 *   - manual "send now" calls build the link on demand.
 */

export const WHATSAPP_PHONE_KEY = "whatsapp_digest_phone";
export const WHATSAPP_ENABLED_KEY = "whatsapp_digest_enabled";
const SENT_KEY_PREFIX = `${DIGEST_SENT_KEY_PREFIX}whatsapp:`;

export interface WhatsAppConfig {
  /** Normalized E.164 digits (e.g. "919876543210"), or null when unset. */
  phone: string | null;
  /** Automatic weekly/monthly digest enabled (phone must also be set). */
  enabled: boolean;
}


export async function getWhatsAppDigestConfig(): Promise<WhatsAppConfig> {
  const [phone, enabled] = await Promise.all([
    getAppSetting(db, WHATSAPP_PHONE_KEY),
    getAppSetting(db, WHATSAPP_ENABLED_KEY),
  ]);
  return { phone, enabled: enabled === "1" };
}

export async function setWhatsAppDigestConfig(phone: string, enabled: boolean): Promise<void> {
  await setAppSetting(db, WHATSAPP_PHONE_KEY, phone);
  await setAppSetting(db, WHATSAPP_ENABLED_KEY, enabled ? "1" : "0");
}


/** The full pre-filled wa.me link for a period + config. */
export async function buildWhatsAppDigestLink(period: DigestPeriod, phoneDigits: string): Promise<string> {
  const text = buildWhatsAppDigestText({ ...(await getDigestData(period.start, period.end)), label: period.label });
  return buildWhatsAppLink(phoneDigits, text);
}

/**
 * Record a WhatsApp "send" (a wa.me link was prepared for the household to
 * tap Send) — the same marker the cron's ping writes, so the cards show one
 * last-sent history per channel. Called by the manual send action, never by
 * plain link rendering (dashboard banner), which would record page views.
 */
export async function recordWhatsAppDigestSent(period: DigestPeriod): Promise<void> {
  await setAppSetting(db, `${SENT_KEY_PREFIX}${period.key}`, new Date().toISOString());
}

export interface DigestDayContext {
  period: DigestPeriod;
  /** Pre-filled wa.me link when WhatsApp is configured AND auto-digest enabled, else null. */
  waUrl: string | null;
}

/**
 * Server-side context for the dashboard/settings "digest due today" banner.
 * The cron and the pages all derive from digestPeriodForDate, so the banner,
 * the ping and the Telegram send can never disagree about what is due.
 */
export async function getDigestDayContext(dateStr: string): Promise<DigestDayContext | null> {
  const period = digestPeriodForDate(dateStr);
  if (!period) return null;
  const config = await getWhatsAppDigestConfig();
  const waUrl = config.enabled && config.phone ? await buildWhatsAppDigestLink(period, config.phone) : null;
  return { period, waUrl };
}

export interface PingResult {
  ok: boolean;
  status?: number;
  error?: string;
  /** True when the ping was skipped because this period already fired. */
  alreadyPinged?: boolean;
  sent: number;
  failed: number;
  stale: number;
}

/**
 * Push a "digest ready — tap to send on WhatsApp" notification to every
 * opted-in device, once per period. The ping is a reminder only; the actual
 * send is the wa.me link in the app's dashboard banner.
 */
export async function pingDigestReady(period: DigestPeriod): Promise<PingResult> {
  const base: PingResult = { ok: false, sent: 0, failed: 0, stale: 0 };

  if (!isPushConfigured()) {
    return { ...base, status: 503, error: "Web Push is not configured (set VAPID_* env vars)" };
  }

  const subs = await db.select().from(pushSubscriptions);
  if (subs.length === 0) {
    return { ...base, ok: true, status: 200, sent: 0, failed: 0, stale: 0 };
  }

  const pingKey = `${SENT_KEY_PREFIX}${period.key}`;
  if (await getAppSetting(db, pingKey)) {
    return { ...base, ok: true, status: 200, alreadyPinged: true };
  }

  const data = await getDigestData(period.start, period.end);
  const notification = {
    title: "Family Ledger · Digest ready",
    body: `${period.label}: ${formatINR(data.totalPaise)} · ${data.count} ${data.count === 1 ? "entry" : "entries"} — tap to send on WhatsApp`,
    // The dashboard banner renders the wa.me link; the ping points there so
    // the deep link never goes stale.
    url: "/",
  };

  let sent = 0;
  let failed = 0;
  const staleEndpoints: string[] = [];
  for (const sub of subs) {
    let status: SendStatus;
    try {
      status = await sendWebPush({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, notification);
    } catch {
      status = "failed";
    }
    if (status === "sent") sent += 1;
    else if (status === "failed") failed += 1;
    else staleEndpoints.push(sub.endpoint);
  }
  if (staleEndpoints.length > 0) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, staleEndpoints));
  }

  // Same marker as recordWhatsAppDigestSent — doubles as the ping gate.
  await setAppSetting(db, pingKey, new Date().toISOString());

  const ok = sent > 0 || failed === 0;
  return { ...base, ok, status: ok ? 200 : 502, sent, failed, stale: staleEndpoints.length };
}