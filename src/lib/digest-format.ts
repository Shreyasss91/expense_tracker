import { format, parse } from "date-fns";
import { formatINR } from "@/lib/money";
import { dateSchema } from "@/lib/validations";

/**
 * Pure digest layer — every function here is free of DB access and
 * server-only imports, so the period math, formatters and link builder are
 * unit-testable (see src/lib/digest-test.ts). The DB-backed aggregates live
 * in src/lib/digest.ts, which re-exports this module's types and helpers.
 *
 * Periods are anchored to the calendar, per the owner's schedule:
 *   - the 7th, 14th, 21st, 28th → weekly digest covering 1–7, 8–14, 15–21, 22–28
 *   - the last day of the month → monthly digest covering the whole month
 *     (and when a date is both — February's 28th — the monthly digest wins,
 *     since it already spans that week's range)
 *   - manual sends: any picked month, or 1st-of-current-month → today
 */

export type DigestKind = "weekly" | "monthly" | "month" | "mtd";

export interface DigestPeriod {
  kind: DigestKind;
  /** YYYY-MM-DD, IST calendar dates (inclusive). */
  start: string;
  end: string;
  /** Human label, e.g. "1–7 Sep", "September 2026", "1 Sep – today". */
  label: string;
  /** `${start}..${end}` — stable idempotency key shared by both channels. */
  key: string;
}

export interface DigestData {
  start: string;
  end: string;
  totalPaise: number;
  count: number;
  recurringPaise: number;
  lifestylePaise: number;
  oneTimePaise: number;
  categories: { name: string; paise: number }[];
  members: { name: string; paise: number }[];
}

/** "1–7 Sep" style label for a date range. */
function shortRangeLabel(start: string, end: string): string {
  return `${format(parse(`${start}T00:00:00`, "yyyy-MM-dd'T'HH:mm:ss", new Date()), "d MMM")}–${format(parse(`${end}T00:00:00`, "yyyy-MM-dd'T'HH:mm:ss", new Date()), "d MMM")}`;
}

/** Full month label, e.g. "September 2026". */
function monthLabel(monthKey: string): string {
  return format(parse(`${monthKey}-01T00:00:00`, "yyyy-MM-dd'T'HH:mm:ss", new Date()), "MMMM yyyy");
}

function periodKey(start: string, end: string): string {
  return `${start}..${end}`;
}

/** The full calendar month a "yyyy-MM" key spans. */
export function monthPeriod(monthKey: string): DigestPeriod {
  const [y, m] = monthKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const start = `${monthKey}-01`;
  const end = `${monthKey}-${String(lastDay).padStart(2, "0")}`;
  return { kind: "month", start, end, label: monthLabel(monthKey), key: periodKey(start, end) };
}

/** 1st of the month containing `todayStr` → today. Used for "this month so far". */
export function monthToDatePeriod(todayStr: string): DigestPeriod {
  const monthKey = todayStr.slice(0, 7);
  const start = `${monthKey}-01`;
  return { kind: "mtd", start, end: todayStr, label: `${shortRangeLabel(start, todayStr)} (to date)`, key: periodKey(start, todayStr) };
}

/**
 * The digest due on a given IST calendar date (YYYY-MM-DD), or null when that
 * date is not a digest day. Pure calendar math — the cron and the dashboard
 * banner both derive from this, so they can never disagree.
 */
export function digestPeriodForDate(dateStr: string): DigestPeriod | null {
  const parsed = dateSchema.safeParse(dateStr);
  if (!parsed.success) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const monthKey = dateStr.slice(0, 7);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();

  // Monthly wins on collision (e.g. 28 Feb): it already spans the whole month.
  // Kind "monthly" (not monthPeriod's "month") so the due-digest callers can
  // tell a scheduled month-end digest from a manual full-month send.
  if (d === lastDay) return { ...monthPeriod(monthKey), kind: "monthly" as const };
  const weeklyStarts: Record<number, string> = { 7: `${monthKey}-01`, 14: `${monthKey}-08`, 21: `${monthKey}-15`, 28: `${monthKey}-22` };
  const start = weeklyStarts[d];
  if (!start) return null;
  return { kind: "weekly", start, end: dateStr, label: shortRangeLabel(start, dateStr), key: periodKey(start, dateStr) };
}

function escapeTelegramHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Telegram flavor: HTML formatting (the bot API's parse_mode=HTML). */
export function buildTelegramDigestMessage(input: DigestData & { label: string }): string {
  const lines = [
    `<b>Family Ledger · ${escapeTelegramHtml(input.label)}</b>`,
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

/**
 * WhatsApp flavor: plain text with WhatsApp's own markdown (*bold*). This is
 * the body that gets URL-encoded into a wa.me Click-to-Chat link — WhatsApp
 * renders the asterisk formatting as bold once the draft is sent.
 */
export function buildWhatsAppDigestText(input: DigestData & { label: string }): string {
  const lines = [
    `📊 Family Ledger · ${input.label}`,
    `Total: *${formatINR(input.totalPaise)}* · ${input.count} ${input.count === 1 ? "entry" : "entries"}`,
    "",
    `*By tag*`,
    `• Lifestyle: ${formatINR(input.lifestylePaise)}`,
    `• Bills: ${formatINR(input.recurringPaise)}`,
    `• One-time: ${formatINR(input.oneTimePaise)}`,
  ];

  if (input.categories.length > 0) {
    lines.push("", "*Top categories*");
    for (const category of input.categories) {
      lines.push(`• ${category.name}: ${formatINR(category.paise)}`);
    }
  }
  if (input.members.length > 0) {
    lines.push("", "*By member*");
    for (const member of input.members) {
      lines.push(`• ${member.name}: ${formatINR(member.paise)}`);
    }
  }
  return lines.join("\n");
}

/**
 * Normalize a user-typed number to E.164 digits. Accepts "+91 98765 43210",
 * "919876543210", "09876543210" etc.; 10 digits are assumed to be an Indian
 * number and get the +91 country code. Returns null when unusable.
 */
export function normalizeWhatsAppPhone(raw: string): string | null {
  // "09876543210" is an Indian number with the trunk prefix — strip the
  // leading zero, then the 10-digit rule below prepends the country code.
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

/** Display form for the settings card, e.g. "+91 98765 43210". */
export function formatWhatsAppPhone(digits: string): string {
  const withPlus = `+${digits}`;
  return withPlus.replace(/(\+\d{2})(\d{5})(\d{5})$/, "$1 $2 $3");
}

/** wa.me Click-to-Chat link with the digest text pre-filled. */
export function buildWhatsAppLink(phoneDigits: string, text: string): string {
  return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(text)}`;
}