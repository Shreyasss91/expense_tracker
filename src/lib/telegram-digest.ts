import "server-only";

import { addMonths, format, parse } from "date-fns";
import { and, asc, desc, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { getAppSetting, setAppSetting } from "@/db/app-settings-mutations";
import { categories, members, transactions } from "@/db/schema";
import { monthKeyInIST, monthEndInIST } from "@/lib/dates";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { monthKeySchema } from "@/lib/validations";

const SENT_KEY_PREFIX = "telegram_digest_sent:";

function escapeTelegramHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function previousMonthInIST(): string {
  const current = monthKeyInIST();
  return format(addMonths(parse(`${current}-01`, "yyyy-MM-dd", new Date()), -1), "yyyy-MM");
}

export function buildTelegramDigestMessage(input: {
  month: string;
  totalPaise: number;
  count: number;
  recurringPaise: number;
  lifestylePaise: number;
  oneTimePaise: number;
  categories: { name: string; paise: number }[];
  members: { name: string; paise: number }[];
}): string {
  const label = format(parse(`${input.month}-01`, "yyyy-MM-dd", new Date()), "MMMM yyyy");
  const lines = [
    `<b>Family Ledger · ${escapeTelegramHtml(label)}</b>`,
    `Total: <b>${formatINR(input.totalPaise)}</b> · ${input.count} ${input.count === 1 ? "entry" : "entries"}`,
    "",
    `<b>By tag</b>`,
    `• Lifestyle: ${formatINR(input.lifestylePaise)}`,
    `• Bills: ${formatINR(input.recurringPaise)}`,
    `• One-time: ${formatINR(input.oneTimePaise)}`,
  ];

  if (input.categories.length > 0) {
    lines.push("", "<b>Top categories</b>");
    for (const category of input.categories) {
      lines.push(`• ${escapeTelegramHtml(category.name)}: ${formatINR(category.paise)}`);
    }
  }
  if (input.members.length > 0) {
    lines.push("", "<b>By member</b>");
    for (const member of input.members) {
      lines.push(`• ${escapeTelegramHtml(member.name)}: ${formatINR(member.paise)}`);
    }
  }
  return lines.join("\n");
}

async function getDigestData(month: string) {
  const parsed = monthKeySchema.parse(month);
  const start = `${parsed}-01`;
  const [year, monthNumber] = parsed.split("-").map(Number);
  const end = monthEndInIST(new Date(Date.UTC(year, monthNumber - 1, 1)));
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
    month: parsed,
    totalPaise: rupeesToPaise(totalsRow?.total ?? "0"),
    count: Number(totalsRow?.count ?? 0),
    recurringPaise: rupeesToPaise(totalsRow?.recurring ?? "0"),
    lifestylePaise: rupeesToPaise(totalsRow?.lifestyle ?? "0"),
    oneTimePaise: rupeesToPaise(totalsRow?.oneTime ?? "0"),
    categories: categoryRows.map((row) => ({ name: row.name, paise: rupeesToPaise(row.total) })),
    members: memberRows.map((row) => ({ name: row.name, paise: rupeesToPaise(row.total) })),
  };
}

export async function sendMonthlyTelegramDigest(month = previousMonthInIST()) {
  const parsedMonth = monthKeySchema.safeParse(month);
  if (!parsedMonth.success) return { ok: false as const, status: 400, error: "Invalid month" };

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { ok: false as const, status: 503, error: "Telegram is not configured" };

  const sentKey = `${SENT_KEY_PREFIX}${parsedMonth.data}`;
  if (await getAppSetting(db, sentKey)) {
    return { ok: true as const, sent: false, month: parsedMonth.data, reason: "already_sent" as const };
  }

  const message = buildTelegramDigestMessage(await getDigestData(parsedMonth.data));
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

  await setAppSetting(db, sentKey, new Date().toISOString());
  return { ok: true as const, sent: true, month: parsedMonth.data };
}
