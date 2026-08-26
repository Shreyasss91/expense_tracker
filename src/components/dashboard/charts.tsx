"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Cell,
  Bar,
  BarChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Link from "next/link";
import { ArrowUpRight, ChevronRight, CornerLeftUp } from "lucide-react";
import { buildLedgerUrl } from "@/lib/ledger-url";
import { formatINR } from "@/lib/money";

export interface CategorySlice {
  name: string;
  emoji: string;
  color: string;
  paise: number;
  /** UX pass — last month's total for the same category; MoM delta chip in the legend. */
  prevPaise?: number;
}

/**
 * Two-level hierarchy — one leaf row as fetched by the dashboard: its own
 * spend plus everything needed to roll it up into its group client-side.
 * `parentId === null` marks uncategorized spend, which is rendered as its
 * own standalone slice at group level (Amendment 20 keeps it explicit).
 */
export interface CategoryTreeSlice extends CategorySlice {
  id: string | null;
  parentId: string | null;
  groupName?: string;
  groupEmoji?: string;
  groupColor?: string;
}

export interface TrendPoint {
  label: string;
  expensePaise: number;
}

const tooltipStyle = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--popover))",
  color: "hsl(var(--popover-foreground))",
};

function inr(v: number) {
  return formatINR(v);
}

/** §6.3.1 — a zero denominator renders — and holds the bar at 0% (no NaN/Infinity). */
export function pct(value: number, total: number): number | null {
  if (total <= 0) return null;
  return (value / total) * 100;
}

/**
 * UX pass — month-over-month chip in the pie legend. ▲ red when the category
 * grew vs last month, ▼ green when it shrank; "new" for spend with no
 * last-month baseline. Hidden entirely when there's nothing to compare
 * (no current and no previous spend) so quiet categories stay quiet.
 */
function CategoryDelta({ current, previous }: { current: number; previous?: number }) {
  if (previous === undefined || (current === 0 && previous === 0)) return null;
  if (previous === 0) {
    return (
      <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">new</span>
    );
  }
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 1) {
    return <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">—</span>;
  }
  const up = change > 0;
  return (
    <span
      className={`shrink-0 text-[10px] font-medium tabular-nums ${up ? "text-red-600" : "text-emerald-600"}`}
    >
      {up ? "▲" : "▼"}
      {Math.abs(change).toFixed(0)}%
    </span>
  );
}

interface PieLevel {
  /** Stable React key + expansion id ("null" for the uncategorized pseudo-group). */
  key: string;
  name: string;
  emoji: string;
  color: string;
  paise: number;
  prevPaise: number;
  /** Children under this group — present only on real, non-leaf levels. */
  children?: PieLevel[];
  /** The group's category id — set on top-level rows so the legend can deep-link into the ledger (?group=). */
  groupId?: string;
}

/**
 * Two-level pie — defaults to GROUP slices (~7), tap a legend row to drill
 * into that group's categories in place; a "back" row returns. Uncategorized
 * spend stays its own explicit top-level slice (Amendment 20). MoM delta
 * chips recompute for whatever level is shown: prev values arrive per leaf
 * and are summed alongside the current totals, so both levels agree.
 */
/**
 * `month` (optional) is carried into the drill-through ledger link so tapping
 * a group lands on the same month the pie is describing.
 */
export function CategoryPie({ leaves, month }: { leaves: CategoryTreeSlice[]; month?: string }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const topLevel = useMemo<PieLevel[]>(() => {
    const groups = new Map<string, PieLevel>();
    for (const leaf of leaves) {
      if (leaf.parentId === null || !leaf.parentId) {
        // Uncategorized — a standalone slice at group level, never expandable
        const key = "u:null";
        const g = groups.get(key);
        if (g) {
          g.paise += leaf.paise;
          g.prevPaise += leaf.prevPaise ?? 0;
        } else {
          groups.set(key, { key, name: "Uncategorized", emoji: "❔", color: "#9ca3af", paise: leaf.paise, prevPaise: leaf.prevPaise ?? 0 });
        }
        continue;
      }
      const key = `g:${leaf.parentId}`;
      let g = groups.get(key);
      if (!g) {
        g = { key, name: leaf.groupName ?? "—", emoji: leaf.groupEmoji ?? "🧺", color: leaf.groupColor ?? "#9ca3af", paise: 0, prevPaise: 0, children: [], groupId: leaf.parentId };
        groups.set(key, g);
      }
      g.paise += leaf.paise;
      g.prevPaise += leaf.prevPaise ?? 0;
      g.children!.push({ key: `c:${leaf.id}`, name: leaf.name, emoji: leaf.emoji, color: leaf.color, paise: leaf.paise, prevPaise: leaf.prevPaise ?? 0 });
    }
    return [...groups.values()];
  }, [leaves]);

  const level = expandedKey ? topLevel.find((g) => g.key === expandedKey)?.children ?? [] : topLevel;

  const total = level.reduce((s, c) => s + c.paise, 0);

  // §6.3.1 empty state: a card, not a zero-slice chart
  if (total === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed text-center">
        <span className="text-2xl">📊</span>
        <p className="mt-1 text-sm text-muted-foreground">No expenses this month</p>
      </div>
    );
  }

  return (
    <div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            {/* slice strokes follow the theme background so slices read as
                one chart in both modes (white gaps look harsh in dark) */}
            <Pie data={level} dataKey="paise" nameKey="name" innerRadius={48} outerRadius={80} paddingAngle={2} strokeWidth={1} stroke="hsl(var(--background))">
              {level.map((s) => (
                <Cell key={s.key} fill={s.color} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => inr(Number(v))} contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 space-y-1">
        {expandedKey && (
          <li>
            <button
              type="button"
              onClick={() => setExpandedKey(null)}
              className="flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <CornerLeftUp className="h-3.5 w-3.5" /> All groups
            </button>
          </li>
        )}
        {level
          .slice()
          .sort((a, b) => b.paise - a.paise)
          .map((s) => {
            const expandable = !expandedKey && !!s.children;
            // Drill-through — top-level groups deep-link into the ledger
            // pre-filtered to ?group=<uuid> (plus the month being viewed), so a
            // slice answers "what exactly did we spend here on?" in one tap.
            const ledgerHref = s.groupId && !expandedKey ? buildLedgerUrl({ groupId: s.groupId, month }) : null;
            return (
              <li key={s.key} className="flex items-center gap-1">
                {expandable ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setExpandedKey(s.key)}
                      aria-label={`Show categories in ${s.name}`}
                      className="flex flex-1 items-center gap-2 rounded-lg px-1 py-0.5 text-left text-sm transition-colors hover:bg-muted"
                    >
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <LegendRowContent slice={{ ...s }} total={total} />
                    </button>
                    {ledgerHref && (
                      <Link
                        href={ledgerHref}
                        aria-label={`Open ${s.name} in the ledger`}
                        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </>
                ) : (
                  <div className="flex flex-1 items-center gap-2 px-1 py-0.5 text-sm">
                    {!expandedKey && <span className="w-3.5 shrink-0" />}
                    <LegendRowContent slice={s} total={total} />
                  </div>
                )}
              </li>
            );
          })}
      </ul>
    </div>
  );
}

/** The shared legend line: swatch · name · MoM chip · amount · share. */
function LegendRowContent({ slice, total }: { slice: PieLevel; total: number }) {
  const p = pct(slice.paise, total);
  return (
    <>
      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: slice.color }} />
      <span className="truncate">
        {slice.emoji} {slice.name}
      </span>
      <CategoryDelta current={slice.paise} previous={slice.prevPaise} />
      <span className="ml-auto tabular-nums font-medium">{formatINR(slice.paise)}</span>
      <span className="w-12 text-right tabular-nums text-muted-foreground">
        {p === null ? "—" : `${p.toFixed(0)}%`}
      </span>
    </>
  );
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const hasExpense = points.some((p) => p.expensePaise > 0);

  if (!hasExpense) {
    return (
      <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed text-center">
        <span className="text-2xl">📈</span>
        <p className="mt-1 text-sm text-muted-foreground">No activity in the last 6 months</p>
      </div>
    );
  }

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          {/* tick fill defaults to #666, which is unreadable on a dark card —
              pin it to the theme's muted foreground instead */}
          <XAxis dataKey="label" interval="preserveStartEnd" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => (Number(v) >= 100000 ? `${Number(v) / 100000}L` : `${Number(v) / 1000}k`)} />
          <Tooltip formatter={(v) => [inr(Number(v)), "Expense"]} contentStyle={tooltipStyle} cursor={{ fill: "hsl(var(--muted))" }} />
          <Bar dataKey="expensePaise" name="Expense" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={42} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Simple horizontal bars for the tag breakdown (zero-safe, §6.3.1). */
export function TagBar({
  label,
  paise,
  totalExpense,
  color,
}: {
  label: string;
  paise: number;
  totalExpense: number;
  color: string;
}) {
  const p = pct(paise, totalExpense);
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {formatINR(paise)} · {p === null ? "—" : `${p.toFixed(0)}%`}
        </span>
      </div>
      <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full transition-all" style={{ width: `${p ?? 0}%`, background: color }} />
      </div>
    </div>
  );
}
