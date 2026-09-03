import { Skeleton } from "@/components/ui/skeleton";

/**
 * UX pass — mirrors the Overview page's real layout order and approximate
 * card heights (hero → 3-up stats → budget → tags → category pie → trend),
 * so the skeleton hands off to content without visible layout shift.
 *
 * §3.6 — heights track the cards they replace instead of one hardcoded
 * `h-[340px]`: every dashboard card renders a variable number of rows
 * (insights, suggestions, group budgets, who-spent are all conditional), so
 * the pie/trend blocks use `min-h` bands — tall enough to hold the common
 * case, allowed to grow — rather than a fixed height that guaranteed shift
 * whenever the real card was taller or shorter.
 */
export default function AppLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>

      {/* Expense hero */}
      <Skeleton className="min-h-[108px] rounded-xl" />

      {/* Top category · Bills · Lifestyle */}
      <div className="grid grid-cols-3 gap-2">
        <Skeleton className="min-h-20 rounded-xl" />
        <Skeleton className="min-h-20 rounded-xl" />
        <Skeleton className="min-h-20 rounded-xl" />
      </div>

      {/* Budget card */}
      <Skeleton className="min-h-[132px] rounded-xl" />

      {/* Tag breakdown */}
      <Skeleton className="min-h-[168px] rounded-xl" />

      {/* Spending by category (pie + legend) — legend rows vary by category count */}
      <Skeleton className="min-h-[280px] rounded-xl" />

      {/* 6-month trend — chart + title */}
      <Skeleton className="min-h-[288px] rounded-xl" />
    </div>
  );
}
