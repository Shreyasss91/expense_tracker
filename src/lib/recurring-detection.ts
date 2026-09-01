import { unstable_cache } from "next/cache";
import { addDays, addMonths, differenceInCalendarDays, format, parseISO } from "date-fns";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, templates, transactions } from "@/db/schema";
import { rupeesToPaise } from "@/lib/money";
import { todayInIST } from "@/lib/dates";

/**
 * §2.4 — Recurring detection, not just recurring templates.
 *
 * Templates ask the user to *declare* a bill repeats. Most households never
 * do. Instead we mine the trailing 6 months of the ledger for stable
 * clusters that look like standing instructions:
 *   - same (loosely normalised) note  AND
 *   - same category                      AND
 *   - amount within ±5% of each other    AND
 *   - a ~30-day cadence (gaps in [20,40] days) on most occurrences.
 * Each surviving cluster becomes a one-tap "create a template" suggestion on
 * the dashboard. Clusters already covered by an existing template are
 * suppressed so we never nag about a bill the user already automated.
 */

export interface RecurringSuggestion {
  /** Stable, React-friendly key (note+category+canonical amount). */
  key: string;
  note: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryEmoji: string | null;
  /** Integer paise — the cluster's mean amount, rounded. */
  canonicalPaise: number;
  occurrences: number;
  firstDate: string;
  lastDate: string;
  avgGapDays: number;
  /** Predicted next occurrence: last date + mean gap. */
  nextDueDate: string;
}

const AMOUNT_TOLERANCE = 0.05; // ±5%
const MIN_GAP = 20; // days — below this it isn't monthly
const MAX_GAP = 40; // days — above this it isn't monthly
const MIN_OCCURRENCES = 2;
const MAX_SUGGESTIONS = 6;

/** Keep only letters — drops digits, spaces, punctuation so "Airtel 2499"
 * and "Airtel Postpaid" collapse to the same normalised key. */
function normalizeNote(note: string | null): string {
  return (note ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

function withinTolerance(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return a === b;
  return Math.abs(a - b) / Math.min(a, b) <= AMOUNT_TOLERANCE;
}

async function detectRecurringSuggestions(): Promise<RecurringSuggestion[]> {
  const today = parseISO(todayInIST());
  const since = format(addMonths(today, -5), "yyyy-MM-01");

  const rows = await db
    .select({
      id: transactions.id,
      amount: transactions.amount,
      note: transactions.note,
      date: transactions.date,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(gte(transactions.date, since))
    .orderBy(asc(transactions.date));

  // Existing templates suppress suggestions we've already automated.
  const existing = await db
    .select({
      note: templates.note,
      name: templates.name,
      amount: templates.amount,
      categoryId: templates.categoryId,
    })
    .from(templates);
  const existingKeys = existing.map((t) => ({
    norm: normalizeNote(t.note) || normalizeNote(t.name),
    paise: rupeesToPaise(t.amount),
    categoryId: t.categoryId,
  }));

  // Group first by (normalised note, category) so two different bills of the
  // same amount (e.g. two ₹499 subs) never merge.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const nk = normalizeNote(r.note) || (r.categoryId ? `c:${r.categoryId}` : "uncat");
    const key = `${nk}|${r.categoryId ?? "∅"}`;
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }

  const suggestions: RecurringSuggestion[] = [];

  for (const [groupKey, groupRows] of groups) {
    // Within a group, cluster by amount (±5%).
    const clusters: { repPaise: number; members: typeof groupRows }[] = [];
    for (const r of groupRows) {
      const paise = rupeesToPaise(r.amount);
      const hit = clusters.find((c) => withinTolerance(c.repPaise, paise));
      if (hit) hit.members.push(r);
      else clusters.push({ repPaise: paise, members: [r] });
    }

    const nk = groupKey.split("|")[0];

    for (const cluster of clusters) {
      const members = cluster.members.slice().sort((a, b) => a.date.localeCompare(b.date));
      if (members.length < MIN_OCCURRENCES) continue;

      // Cadence check: most gaps should be ~30 days.
      const gaps: number[] = [];
      for (let i = 1; i < members.length; i++) {
        const g = differenceInCalendarDays(parseISO(members[i].date), parseISO(members[i - 1].date));
        if (g >= MIN_GAP && g <= MAX_GAP) gaps.push(g);
      }
      const requiredMonthlyGaps = Math.max(1, members.length - 2);
      if (gaps.length < requiredMonthlyGaps) continue;

      const avgGap = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length);
      const first = members[0];
      const last = members[members.length - 1];
      const canonicalPaise = Math.round(
        cluster.members.reduce((s, m) => s + rupeesToPaise(m.amount), 0) / cluster.members.length,
      );

      const alreadyCovered = existingKeys.some(
        (e) =>
          withinTolerance(e.paise, canonicalPaise) &&
          ((e.norm && e.norm === nk) || (e.categoryId && e.categoryId === last.categoryId)),
      );
      if (alreadyCovered) continue;

      suggestions.push({
        key: `${groupKey}|${canonicalPaise}`,
        note: last.note,
        categoryId: last.categoryId,
        categoryName: last.categoryName,
        categoryEmoji: last.categoryEmoji,
        canonicalPaise,
        occurrences: members.length,
        firstDate: first.date,
        lastDate: last.date,
        avgGapDays: avgGap,
        nextDueDate: format(addDays(parseISO(last.date), avgGap), "yyyy-MM-dd"),
      });
    }
  }

  // Rank: most frequent first, then most recent — surfaced top of the list.
  suggestions.sort((a, b) => b.occurrences - a.occurrences || b.lastDate.localeCompare(a.lastDate));
  return suggestions.slice(0, MAX_SUGGESTIONS);
}

/**
 * Cached so the 6-month scan doesn't run on every dashboard paint. Tagged
 * "transactions" — every mutation revalidates that tag, so newly entered
 * bills make fresh suggestions appear (and a template created from a
 * suggestion suppresses it on the next refresh).
 */
export const getRecurringSuggestions = unstable_cache(
  () => detectRecurringSuggestions(),
  ["family-ledger", "recurring-suggestions"],
  { tags: ["transactions"], revalidate: 60 },
);
