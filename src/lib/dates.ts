import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { APP_TIMEZONE } from "./constants";

// §5.7: every business-date decision is derived through APP_TIMEZONE.
// Bare new Date() is prohibited for any business-date decision.

/** Today's calendar date in IST, as YYYY-MM-DD. */
export function todayInIST(): string {
  return formatInTimeZone(new Date(), APP_TIMEZONE, "yyyy-MM-dd");
}

/** Current clock time in IST, as HH:MM. */
export function nowTimeInIST(): string {
  return formatInTimeZone(new Date(), APP_TIMEZONE, "HH:mm");
}

/** Last day of the month containing `date` (defaults to now), YYYY-MM-DD in IST. */
export function monthEndInIST(date: Date = new Date()): string {
  const year = formatInTimeZone(date, APP_TIMEZONE, "yyyy");
  const month = formatInTimeZone(date, APP_TIMEZONE, "MM");
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return `${year}-${month}-${String(lastDay).padStart(2, "0")}`;
}

/** "yyyy-MM" for the month containing `date`. */
export function monthKeyInIST(date: Date = new Date()): string {
  return formatInTimeZone(date, APP_TIMEZONE, "yyyy-MM");
}

/**
 * §1.10 — the LAST day of a "yyyy-MM" month key, as YYYY-MM-DD. Pure
 * calendar math (no timezone), shared by the ledger query, the settings
 * budget status and anything else that bounds a month-key range. Previously
 * four copies lived in query.ts / budgets.ts / settings.ts and the budget
 * test; they must all agree, so there is one.
 */
export function monthEndForKey(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error(`Invalid month key: ${monthKey}`);
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${monthKey}-${String(lastDay).padStart(2, "0")}`;
}

/** Group label per §6.4: "Today" | "Yesterday" | "12 Aug 2026". */
export function dateGroupLabel(dateStr: string): string {
  const now = new Date();
  const today = formatInTimeZone(now, APP_TIMEZONE, "yyyy-MM-dd");
  const [year, month, day] = today.split("-").map(Number);
  const yesterdayDate = new Date(Date.UTC(year, month - 1, day - 1));
  const yesterday = formatInTimeZone(yesterdayDate, APP_TIMEZONE, "yyyy-MM-dd");
  if (dateStr === today) return "Today";
  if (dateStr === yesterday) return "Yesterday";
  return format(new Date(`${dateStr}T00:00:00`), "d MMM yyyy");
}

/** HH:MM from a stored HH:MM:SS value (§5.6 display rule). */
export function displayTime(timeStr: string): string {
  return timeStr.slice(0, 5);
}
