import { format, parse, subDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { APP_TIMEZONE } from "./constants";

/**
 * The daily ledger-change feed's window math — pure: no DB access, no
 * `server-only` import, no network. Unit-tested by src/lib/ledger-feed-test.ts
 * exactly like digest-format.ts, because the boundary arithmetic is where the
 * subtle bugs live.
 *
 * The window is the rolling 24 h ending at the canonical boundary:
 *
 *   [yesterday 22:00 IST, today 22:00 IST)
 *
 * and it is always "the most recent boundary that has already passed" — see
 * `feedWindowForInstant`. That rule makes an EARLY fire harmless: at 21:30 the
 * window resolves to yesterday's, whose marker usually exists, so the agent
 * posts nothing. Never "fix" it by clamping forward to tonight's boundary — an
 * early run would then post a partial window and the marker would suppress the
 * rest of the day.
 */

export interface FeedWindow {
  /** Window start as a UTC instant, ISO 8601 — the SQL comparison bound. */
  startIso: string;
  /** Window end (exclusive) as a UTC instant, ISO 8601. */
  endIso: string;
  /** IST wall-clock rendering of the start, e.g. "2026-09-17 22:00". */
  startIst: string;
  /** IST wall-clock rendering of the end, e.g. "2026-09-18 22:00". */
  endIst: string;
  /** IST calendar date of the start, e.g. "2026-09-17". */
  startDateIst: string;
  /** IST calendar date of the end, e.g. "2026-09-18". */
  endDateIst: string;
  /** `${startDateIst}..${endDateIst}` — the stable idempotency key. */
  key: string;
  /** Human label, e.g. "Wed 17 Sep 22:00 → Thu 18 Sep 22:00". */
  label: string;
  /** True when the window ended more than FEED_GRACE_MS before `now`. */
  stale: boolean;
}

/** The canonical boundary hour, in IST. */
export const FEED_HOUR_IST = 22;

/**
 * Grace period after the boundary before a window is considered "late" but
 * still postable. Beyond it the agent refuses to post (never back-fill a
 * missed night) and the 22:15 fallback push is what surfaces the miss.
 */
export const FEED_GRACE_MS = 6 * 60 * 60 * 1000; // 6 h

/** The `<start>..<end>` key shape, shared by the window, the marker and the endpoint's validator. */
export const FEED_KEY_RE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;

/** IST calendar date (YYYY-MM-DD) of an instant. */
function istDateOf(instant: Date): string {
  return formatInTimeZone(instant, APP_TIMEZONE, "yyyy-MM-dd");
}

/** The 22:00 IST boundary instant of an IST calendar date. */
function boundaryForDate(istDate: string): Date {
  return fromZonedTime(`${istDate} ${String(FEED_HOUR_IST).padStart(2, "0")}:00:00`, APP_TIMEZONE);
}

/** Calendar-day subtraction on a YYYY-MM-DD string (no timezone involved). */
function previousIsoDate(isoDate: string): string {
  return format(subDays(parse(isoDate, "yyyy-MM-dd", new Date()), 1), "yyyy-MM-dd");
}

/**
 * §5.1 — the window containing `now`: the most recent 22:00 IST boundary that
 * has already passed, less 24 h.
 *
 * India has no DST, so the offset is a constant (+05:30) — but it is applied
 * through date-fns-tz rather than by adding a magic number of seconds, per
 * SPEC §5.7. Never read the device/server timezone.
 */
export function feedWindowForInstant(now: Date): FeedWindow {
  const todayBoundary = boundaryForDate(istDateOf(now));
  const end =
    now.getTime() >= todayBoundary.getTime()
      ? todayBoundary
      : boundaryForDate(previousIsoDate(istDateOf(now)));
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);

  const startDateIst = istDateOf(start);
  const endDateIst = istDateOf(end);
  const key = `${startDateIst}..${endDateIst}`;

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startIst: formatInTimeZone(start, APP_TIMEZONE, "yyyy-MM-dd HH:mm"),
    endIst: formatInTimeZone(end, APP_TIMEZONE, "yyyy-MM-dd HH:mm"),
    startDateIst,
    endDateIst,
    key,
    label: windowKeyLabel(key),
    stale: now.getTime() - end.getTime() > FEED_GRACE_MS,
  };
}

/**
 * Reconstruct the message header's human label from a stored `key` — the
 * mirror of digest-format.ts's `periodKeyLabel()`, same
 * reconstruct-from-the-key philosophy.
 *
 * **Not used by the digest cards.** They keep using `periodKeyLabel()` (SPEC
 * §2.13), because the stored key already has the `<start>..<end>` shape. This
 * exists only for the feed message's own `_…_` header line.
 */
export function windowKeyLabel(key: string): string {
  const match = FEED_KEY_RE.exec(key);
  if (!match) return key;
  const start = boundaryForDate(match[1]);
  const end = boundaryForDate(match[2]);
  const stamp = (instant: Date) => formatInTimeZone(instant, APP_TIMEZONE, "EEE d MMM HH:mm");
  return `${stamp(start)} → ${stamp(end)}`;
}
