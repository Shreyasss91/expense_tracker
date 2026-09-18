import { format, isValid, parse, subDays } from "date-fns";
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

/** A window reconstructed from a stored or claimed `key` (§5.5.3). */
export interface FeedKeyWindow {
  /** The key verbatim — round-tripped so a caller can echo what it was given. */
  key: string;
  startDateIst: string;
  endDateIst: string;
  /** Window start as a UTC instant, ISO 8601. */
  startIso: string;
  /** Window end (exclusive) as a UTC instant, ISO 8601. */
  endIso: string;
  label: string;
}

/**
 * True when `isoDate` is a real `YYYY-MM-DD` calendar date.
 *
 * `parse()` alone is not enough: it accepts out-of-range components by rolling
 * them over (`2026-02-30` becomes 2 March), so the value is re-formatted and
 * compared — a date that changed is a date that never existed.
 */
function isRealIsoDate(isoDate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return false;
  const parsed = parse(isoDate, "yyyy-MM-dd", new Date());
  return isValid(parsed) && format(parsed, "yyyy-MM-dd") === isoDate;
}

/**
 * Parse a `key` into the window it denotes, or `null` when it is not a real
 * 24-hour window ending on a 22:00 IST boundary.
 *
 * `FEED_KEY_RE` only checks the **shape**, and shape alone is far too weak to
 * write a marker with (§5.5.3): the `POST` body comes from outside the app, and
 * the loose regex happily accepts `9999-99-99..9999-99-99` as well as ranges
 * that are not 24 hours at all (`2026-01-01..2026-12-31`) or run backwards. A
 * marker written under such a key is permanent, and because
 * `getRecentDigestSends()` keeps the newest `app_settings` value per channel, it
 * would also surface on the Settings card as the feed's last send
 * (`periodKeyLabel()` falls back to the raw key).
 *
 * Enforced here, in order: the shape, both dates are real calendar dates, and
 * the two dates are **adjacent** — the key means "these 24 hours".
 */
export function parseFeedKey(key: string): FeedKeyWindow | null {
  const match = FEED_KEY_RE.exec(key);
  if (!match) return null;
  const [, startDateIst, endDateIst] = match;
  if (!isRealIsoDate(startDateIst) || !isRealIsoDate(endDateIst)) return null;
  if (previousIsoDate(endDateIst) !== startDateIst) return null;

  return {
    key,
    startDateIst,
    endDateIst,
    startIso: boundaryForDate(startDateIst).toISOString(),
    endIso: boundaryForDate(endDateIst).toISOString(),
    label: windowKeyLabel(key),
  };
}

/**
 * Has the parsed window actually ended by `now`?
 *
 * §5.5.3 — a window that has not ended must never be recorded as sent. Marking
 * a future window is not merely useless data: the agent would later see
 * `alreadySent` for that night, post nothing, and the 22:15 fallback would stay
 * silent too, because the marker it checks already exists. That turns one bad
 * client (a wrong clock, or an `?at=` pointing forward) into a night that is
 * silently not reported — the exact failure this feature exists to prevent.
 *
 * Both sides of the comparison come from the server (the boundary is derived
 * from the key, `now` from the request), so clock skew between the phone and
 * the deployment cannot cause a false rejection.
 */
export function feedKeyHasEnded(window: FeedKeyWindow, now: Date): boolean {
  return Date.parse(window.endIso) <= now.getTime();
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
