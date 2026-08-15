"use client";

import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
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
}

export interface MemberSlice {
  name: string;
  emoji: string;
  color: string;
  paise: number;
}

export interface TrendPoint {
  label: string;
  expensePaise: number;
  incomePaise: number;
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
            <Pie data={slices} dataKey="paise" nameKey="name" innerRadius={48} outerRadius={80} paddingAngle={2} strokeWidth={1}>
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

export function MemberSplit({ slices }: { slices: MemberSlice[] }) {
  const total = slices.reduce((s, m) => s + m.paise, 0);
  const max = Math.max(...slices.map((m) => m.paise), 1);

  return (
    <ul className="space-y-3">
      {slices.map((m) => {
        const p = pct(m.paise, total);
        return (
          <li key={m.name}>
            <div className="flex items-center gap-2 text-sm">
              <span className="w-8 text-center text-base leading-none">{m.emoji}</span>
              <span className="w-12 truncate font-medium">{m.name}</span>
              <span className="ml-auto tabular-nums">{formatINR(m.paise)}</span>
              <span className="w-12 text-right tabular-nums text-muted-foreground">
                {p === null ? "—" : `${p.toFixed(0)}%`}
              </span>
            </div>
            {/* §6.3.1: 0-width bar, never NaN width */}
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${m.paise > 0 ? (m.paise / max) * 100 : 0}%`, background: m.color }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const hasExpense = points.some((p) => p.expensePaise > 0);
  const hasIncome = points.some((p) => p.incomePaise > 0);

  if (!hasExpense && !hasIncome) {
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
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="label" interval="preserveStartEnd" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => (Number(v) >= 100000 ? `${Number(v) / 100000}L` : `${Number(v) / 1000}k`)} />
          <Tooltip formatter={(v, name) => [inr(Number(v)), name === "expensePaise" ? "Expense" : "Income"]} contentStyle={tooltipStyle} />
          {hasExpense && <Line type="monotone" dataKey="expensePaise" name="Expense" stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} />}
          {hasIncome && <Line type="monotone" dataKey="incomePaise" name="Income" stroke="#059669" strokeWidth={2} dot={{ r: 2 }} />}
        </LineChart>
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
