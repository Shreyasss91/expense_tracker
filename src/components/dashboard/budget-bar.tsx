import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";

/** §6.7 — spent-vs-budget bar. The fill's colour ramps deep green → deep red
 * across the band (0% → 100% of the budget). When spent exceeds the budget the
 * band shrinks to make room for a deep-red overflow segment, so the amount over
 * is visible as bar length and the whole bar still fits its container. A tick
 * marks the 100% point — the budget limit — partitioning the band from the
 * overflow. */
export function BudgetBar({
  spent,
  budget,
  className = "h-1.5",
  /** UX pass — subtle attention pulse on the overflow segment once the budget is blown. */
  pulseOver = false,
}: {
  spent: number;
  budget: number;
  className?: string;
  pulseOver?: boolean;
}) {
  // §6.3.1: never divide by zero — a zero budget renders an empty bar.
  const pct = budget > 0 ? (spent / budget) * 100 : 0;
  if (pct <= 0) return <div className={`relative w-full rounded-full bg-muted ${className}`} />;

  const over = pct > 100;
  // Width of the budget band as a share of the bar. Under budget the band is
  // the whole bar and the fill grows into it; over budget the band shrinks so
  // the overflow segment fits alongside it (fill + overflow = 100%).
  const bandPct = over ? (100 / pct) * 100 : pct;
  // The 100%-of-budget point: the bar's right edge under budget, the boundary
  // between the band and the overflow segment when over budget.
  const limitPct = over ? bandPct : 100;

  return (
    <div className={`relative w-full rounded-full bg-muted ${className}`}>
      {/* In-band portion: the gradient spans the band, so the colour at the
          fill's right edge always reflects the spend level (0% = deep green,
          100% = deep red). */}
      <div
        className="absolute inset-y-0 left-0 overflow-hidden rounded-full transition-all"
        style={{ width: `${bandPct}%` }}
      >
        <div
          className="h-full"
          style={{
            // Under budget the gradient spans the whole bar (the fill's right
            // edge lands mid-spectrum); over budget it spans exactly the band.
            width: `${over ? 100 : (100 / pct) * 100}%`,
            background: BUDGET_GRADIENT,
          }}
        />
      </div>
      {/* Overflow: the spend past 100% of budget, in the deepest red. */}
      {over && (
        <div
          className={cn("absolute inset-y-0 rounded-r-full transition-all", pulseOver && "animate-pulse")}
          style={{ left: `${bandPct}%`, width: `${100 - bandPct}%`, background: OVER_BUDGET_COLOR }}
        />
      )}
      {/* 100% marker — the budget limit; ticks slightly above/below the bar so
          it reads as a marker rather than a seam, even at the bar's edge. */}
      <div
        className="absolute -top-0.5 -bottom-0.5 w-[2px] rounded-full bg-foreground/80 transition-all"
        style={{ left: `calc(${limitPct}% - 1px)` }}
      />
    </div>
  );
}

/** Deep green → deep red ramp for the in-band portion of the bar.
 *  §3.7 — gradient stops read the chart tokens (chart-4 emerald → chart-3
 *  amber → chart-5 red) so the ramp follows the theme instead of hardcoded
 *  hex literals that would sit wrong in dark mode. */
const BUDGET_GRADIENT =
  "linear-gradient(to right, var(--chart-4), color-mix(in srgb, var(--chart-4), var(--chart-3) 50%) 30%, var(--chart-3) 55%, color-mix(in srgb, var(--chart-3), var(--chart-5) 60%) 78%, var(--chart-5))";

/** The overflow segment past 100% of budget — the deepest red. */
const OVER_BUDGET_COLOR = "var(--chart-5)";

/** §6.7 — "₹X left" (green) or "₹X over" (red) under the total budget bar. */
export function BudgetRemaining({ spent, budget }: { spent: number; budget: number }) {
  const remaining = budget - spent;
  return (
    <p className={`text-xs font-medium tabular-nums ${remaining >= 0 ? "text-emerald-600" : "text-red-600"}`}>
      {remaining >= 0 ? `${formatINR(remaining)} left` : `${formatINR(-remaining)} over`}
    </p>
  );
}
