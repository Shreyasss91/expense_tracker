import "server-only";

import { and, asc, desc, gte, like, lte, sql } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/db";
import { appSettings, categories, members, transactions } from "@/db/schema";
import { APP_TIMEZONE } from "@/lib/constants";
import { rupeesToPaise } from "@/lib/money";
import { periodKeyLabel } from "./digest-format";

/**
 * DB-backed digest engine — date-range SQL aggregates for the weekly/monthly
 * digest both channels (Telegram bot, WhatsApp Click-to-Chat) draw from.
 *
 * The pure layer (period math, formatters, phone/link utils) lives in
 * digest-format.ts and is re-exported here so callers keep a single import.
 */

export {
  buildTelegramDigestMessage,
  buildWhatsAppDigestText,
  buildWhatsAppLink,
  digestPeriodForDate,
  formatWhatsAppPhone,
  monthPeriod,
  monthToDatePeriod,
  normalizeWhatsAppPhone,
  periodKeyLabel,
} from "./digest-format";
export type { DigestData, DigestKind, DigestPeriod } from "./digest-format";

/**
 * Last-sent records. One marker per (channel, period): the value is an ISO
 * timestamp written on EVERY successful send (cron AND manual), so it serves
 * double duty as the idempotency gate for the automatic path and as the
 * "last sent" history for the digest cards. Period keys are
 * "<start>..<end>" and labels are reconstructed via periodKeyLabel.
 */
export const DIGEST_SENT_KEY_PREFIX = "digest_sent:";

export interface DigestSendRecord {
  channel: "telegram" | "whatsapp";
  /** The stored period key, e.g. "2026-09-01..2026-09-07". */
  periodKey: string;
  /** Human label, e.g. "1–7 Sep" or "September 2026". */
  label: string;
  /** ISO timestamp of the last send for this channel. */
  sentAt: string;
}

/** Latest send per channel, newest first — what the digest cards display. */
export async function getRecentDigestSends(): Promise<DigestSendRecord[]> {
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(like(appSettings.key, `${DIGEST_SENT_KEY_PREFIX}%`));

  const latest = new Map<string, { periodKey: string; value: string }>();
  for (const row of rows) {
    const rest = row.key.slice(DIGEST_SENT_KEY_PREFIX.length);
    const channel = rest.startsWith("telegram:") ? "telegram" : rest.startsWith("whatsapp:") ? "whatsapp" : null;
    if (!channel) continue;
    const periodKey = rest.slice(channel.length + 1);
    const existing = latest.get(channel);
    if (!existing || row.value > existing.value) latest.set(channel, { periodKey, value: row.value });
  }

  return Array.from(latest.entries())
    .map(([channel, rec]) => ({
      channel: channel as "telegram" | "whatsapp",
      periodKey: rec.periodKey,
      label: periodKeyLabel(rec.periodKey),
      sentAt: rec.value,
    }))
    .sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1));
}

/** ISO → IST display, e.g. "7 Sep, 9:41 PM". */
export function formatSentAtLabel(iso: string): string {
  return formatInTimeZone(new Date(iso), APP_TIMEZONE, "d MMM, h:mm a");
}

/**
 * §17 — date-range aggregates for a digest. Same SQL shape as the original
 * monthly digest, generalized: one pass for totals + per-tag split, top 5
 * categories by spend, per-member spend. All NUMERIC sums are converted to
 * integer paise at the boundary (§5.8).
 */
export async function getDigestData(start: string, end: string): Promise<import("./digest-format").DigestData> {
  const range = and(gte(transactions.date, start), lte(transactions.date, end));

  const [totals, categoryRows, memberRows] = await Promise.all([
    db.select({
      total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
      count: sql<number>`COUNT(*)::int`,
      recurring: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.tag} = 'recurring'), 0)`,
      lifestyle: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.tag} = 'lifestyle'), 0)`,
      oneTime: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.tag} = 'one_time'), 0)`,
    }).from(transactions).where(range),
    db.select({ name: categories.name, total: sql<string>`SUM(${transactions.amount})` })
      .from(transactions)
      .innerJoin(categories, sql`${transactions.categoryId} = ${categories.id}`)
      .where(range)
      .groupBy(categories.id, categories.name)
      .orderBy(desc(sql`SUM(${transactions.amount})`), asc(categories.name))
      .limit(5),
    db.select({ name: members.name, total: sql<string>`SUM(${transactions.amount})` })
      .from(transactions)
      .innerJoin(members, sql`${transactions.memberId} = ${members.id}`)
      .where(range)
      .groupBy(members.id, members.name)
      .orderBy(desc(sql`SUM(${transactions.amount})`), asc(members.name)),
  ]);

  const totalsRow = totals[0];
  return {
    start,
    end,
    totalPaise: rupeesToPaise(totalsRow?.total ?? "0"),
    count: Number(totalsRow?.count ?? 0),
    recurringPaise: rupeesToPaise(totalsRow?.recurring ?? "0"),
    lifestylePaise: rupeesToPaise(totalsRow?.lifestyle ?? "0"),
    oneTimePaise: rupeesToPaise(totalsRow?.oneTime ?? "0"),
    categories: categoryRows.map((row) => ({ name: row.name, paise: rupeesToPaise(row.total) })),
    members: memberRows.map((row) => ({ name: row.name, paise: rupeesToPaise(row.total) })),
  };
}