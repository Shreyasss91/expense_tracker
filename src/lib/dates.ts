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

/** First day of the month containing `date` (defaults to now), YYYY-MM-DD in IST. */
export function monthStartInIST(date: Date = new Date()): string {
  return formatInTimeZone(date, APP_TIMEZONE, "yyyy-MM-01");
}

/** Last day of the month containing `date` (defaults to now), YYYY-MM-DD in IST. */
export function monthEndInIST(date: Date = new Date()): string {
  const year = formatInTimeZone(date, APP_TIMEZONE, "yyyy");
  const month = formatInTimeZone(date, APP_TIMEZONE, "MM");
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return `${year}-${month}-${String(lastDay).padStart(2, "0")}`;
}

/** "August 2026" label for the month containing `date`. */
export function monthLabelInIST(date: Date = new Date()): string {
  return formatInTimeZone(date, APP_TIMEZONE, "MMMM yyyy");
}

/** "yyyy-MM" for the month containing `date`. */
export function monthKeyInIST(date: Date = new Date()): string {
  return formatInTimeZone(date, APP_TIMEZONE, "yyyy-MM");
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
