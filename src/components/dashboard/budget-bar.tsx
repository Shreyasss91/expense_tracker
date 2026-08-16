import { formatINR } from "@/lib/money";

/** §6.7 — spent-vs-budget progress bar; turns red when over budget. */
export function BudgetBar({ spent, budget, className = "h-1.5" }: { spent: number; budget: number; className?: string }) {
  // §6.3.1: never divide by zero — a zero budget renders an empty bar.
  const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  return (
    <div className={`w-full overflow-hidden rounded-full bg-muted ${className}`}>
      <div
        className={`h-full rounded-full transition-all ${spent > budget ? "bg-red-500" : "bg-primary"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** §6.7 — "₹X left" (green) or "₹X over" (red) under the total budget bar. */
export function BudgetRemaining({ spent, budget }: { spent: number; budget: number }) {
  const remaining = budget - spent;
  return (
    <p className={`text-xs font-medium tabular-nums ${remaining >= 0 ? "text-emerald-600" : "text-red-600"}`}>
      {remaining >= 0 ? `${formatINR(remaining)} left` : `${formatINR(-remaining)} over`}
    </p>
  );
}
