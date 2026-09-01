import { formatINR, rupeesToPaise } from "@/lib/money";

/**
 * §2.8 — the diagnostic insight layer. The dashboard used to be purely
 * descriptive (totals, pie, trend). These cheap, high-signal checks turn it
 * into something that tells the household *what to look at*:
 *   - a category blowing past its own 6-month average,
 *   - uncategorized entries (promoted to the top — they silently break every
 *     budget and insight),
 *   - a single spend closing in on that category's all-time record,
 *   - the category that moved most vs last month (surfacing MoM deltas in the
 *     insight layer, not just the pie legend).
 * All inputs are plain aggregates the dashboard already pays for; this is
 * pure derivation, so it is safe to run inside the cached dashboard query.
 */

export type InsightSeverity = "info" | "warning" | "positive";

export interface Insight {
  id: string;
  severity: InsightSeverity;
  title: string;
  detail?: string;
  /** Optional deep link into the ledger filtered to the relevant slice. */
  href?: string;
}

export interface InsightInput {
  monthKey: string;
  /** This month's per-category spend (catRows from the dashboard query). */
  catRows: { id: string | null; name: string | null; emoji: string | null; total: string }[];
  /** Previous-month spend keyed by category id (null = uncategorized). */
  catPrev: Record<string, number>;
  /** Uncategorized count + sum this month. */
  uncat: { count: number; total: string } | null;
  /** Per (categoryId, month) sums over the trailing 6 months. */
  catMonthly: { categoryId: string; month: string; total: string }[];
  /** All-time largest single transaction per category. */
  catRecord: { categoryId: string; max: string }[];
  /** Largest single transaction per category this month. */
  catMonthMax: { categoryId: string; max: string }[];
}

const AVG_OUTLIER_PCT = 25; // a category >25% above its 6-month average is "hot"
const MIN_HISTORY_MONTHS = 3; // need enough history to call something an outlier
const RECORD_CLOSE_RATIO = 0.8; // within 80% of the all-time record = "close"
const MOM_MIN_DELTA = 50000; // ₹500
const MOM_MIN_PCT = 25;

export function computeInsights(input: InsightInput): Insight[] {
  const { monthKey, catRows, catPrev, uncat, catMonthly, catRecord, catMonthMax } = input;
  const insights: Insight[] = [];

  // 1 — Uncategorized entries (promoted to the top; they break every budget).
  if (uncat && uncat.count > 0) {
    const sum = rupeesToPaise(uncat.total);
    insights.push({
      id: "uncategorized",
      severity: "warning",
      title: `${uncat.count} uncategorized ${uncat.count === 1 ? "entry" : "entries"} worth ${formatINR(sum)}`,
      detail: "Assign a category so budgets and insights stay accurate",
      href: `/transactions?month=${monthKey}&category=uncategorized`,
    });
  }

  // Per-category 6-month monthly totals (for the average + history count).
  const monthlyByCat = new Map<string, number[]>();
  for (const r of catMonthly) {
    const arr = monthlyByCat.get(r.categoryId) ?? [];
    arr.push(rupeesToPaise(r.total));
    monthlyByCat.set(r.categoryId, arr);
  }
  const recordMap = new Map(catRecord.map((r) => [r.categoryId, rupeesToPaise(r.max)]));
  const monthMaxMap = new Map(catMonthMax.map((r) => [r.categoryId, rupeesToPaise(r.max)]));

  // 2 — Categories running hot vs their own 6-month average.
  const outliers: { id: string; name: string; emoji: string; pct: number; thisMonth: number; avg: number }[] = [];
  // 3 — Single spend closing in on the category's all-time record.
  const close: { id: string; name: string; emoji: string; record: number; thisMax: number }[] = [];
  // 4 — Biggest month-over-month mover.
  const movers: { id: string; name: string; emoji: string; delta: number }[] = [];

  for (const r of catRows) {
    if (!r.id) continue; // uncategorized handled above
    const id = r.id;
    const thisMonth = rupeesToPaise(r.total);

    const monthly = monthlyByCat.get(id);
    if (monthly && monthly.length >= MIN_HISTORY_MONTHS) {
      const avg = monthly.reduce((a, b) => a + b, 0) / monthly.length;
      if (avg > 0 && thisMonth > avg * (1 + AVG_OUTLIER_PCT / 100)) {
        outliers.push({
          id,
          name: r.name ?? "Category",
          emoji: r.emoji ?? "🏷️",
          pct: Math.round(((thisMonth - avg) / avg) * 100),
          thisMonth,
          avg: Math.round(avg),
        });
      }
    }

    const rec = recordMap.get(id);
    const mx = monthMaxMap.get(id);
    if (rec != null && mx != null && mx > 0 && mx < rec && mx >= rec * RECORD_CLOSE_RATIO) {
      close.push({ id, name: r.name ?? "Category", emoji: r.emoji ?? "🏷️", record: rec, thisMax: mx });
    }

    const prev = catPrev[String(id)] ?? 0;
    if (prev > 0) {
      const delta = thisMonth - prev;
      if (delta > MOM_MIN_DELTA && (delta / prev) * 100 > MOM_MIN_PCT) {
        movers.push({ id, name: r.name ?? "Category", emoji: r.emoji ?? "🏷️", delta });
      }
    }
  }

  outliers.sort((a, b) => b.pct - a.pct);
  for (const o of outliers.slice(0, 2)) {
    insights.push({
      id: `avg-${o.id}`,
      severity: "warning",
      title: `${o.emoji} ${o.name} is ${o.pct}% above your 6-month average`,
      detail: `This month ${formatINR(o.thisMonth)} vs ~${formatINR(o.avg)}/mo typically`,
      href: `/transactions?month=${monthKey}&category=${o.id}`,
    });
  }

  close.sort((a, b) => b.thisMax / b.record - a.thisMax / a.record);
  const c = close[0];
  if (c) {
    insights.push({
      id: `record-${c.id}`,
      severity: "info",
      title: `Largest ever ${c.emoji} ${c.name}: ${formatINR(c.record)}`,
      detail: `This month's ${formatINR(c.thisMax)} is close`,
      href: `/transactions?month=${monthKey}&category=${c.id}`,
    });
  }

  movers.sort((a, b) => b.delta - a.delta);
  const m = movers[0];
  if (m) {
    insights.push({
      id: `mom-${m.id}`,
      severity: "info",
      title: `${m.emoji} ${m.name} is ${formatINR(m.delta)} up vs last month`,
      href: `/transactions?month=${monthKey}&category=${m.id}`,
    });
  }

  return insights;
}
