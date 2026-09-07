import "server-only";

import { and, asc, desc, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, members, transactions } from "@/db/schema";
import { rupeesToPaise } from "@/lib/money";

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
} from "./digest-format";
export type { DigestData, DigestKind, DigestPeriod } from "./digest-format";

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