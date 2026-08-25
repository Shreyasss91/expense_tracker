"use client";

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
import { formatINR } from "@/lib/money";

export interface CategorySlice {
  name: string;
  emoji: string;
  color: string;
  paise: number;
  /** UX pass — last month's total for the same category; MoM delta chip in the legend. */
  prevPaise?: number;
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

export function CategoryPie({ slices }: { slices: CategorySlice[] }) {
  const total = slices.reduce((s, c) => s + c.paise, 0);

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
            <Pie data={slices} dataKey="paise" nameKey="name" innerRadius={48} outerRadius={80} paddingAngle={2} strokeWidth={1} stroke="hsl(var(--background))">
              {slices.map((s) => (
                <Cell key={s.name} fill={s.color} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => inr(Number(v))} contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 space-y-1">
        {slices
          .slice()
          .sort((a, b) => b.paise - a.paise)
          .map((s) => {
            const p = pct(s.paise, total);
            return (
              <li key={s.name} className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
                <span className="truncate">
                  {s.emoji} {s.name}
                </span>
                <CategoryDelta current={s.paise} previous={s.prevPaise} />
                <span className="ml-auto tabular-nums font-medium">{formatINR(s.paise)}</span>
                <span className="w-12 text-right tabular-nums text-muted-foreground">
                  {p === null ? "—" : `${p.toFixed(0)}%`}
                </span>
              </li>
            );
          })}
      </ul>
    </div>
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
