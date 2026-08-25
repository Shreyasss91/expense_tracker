import { Skeleton } from "@/components/ui/skeleton";

/**
 * UX pass — mirrors the Overview page's real layout order and approximate
 * card heights (hero → 3-up stats → budget → tags → category pie → trend),
 * so the skeleton hands off to content without visible layout shift.
 */
export default function AppLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>

      {/* Expense hero */}
      <Skeleton className="h-[108px] rounded-xl" />

      {/* Top category · Bills · Lifestyle */}
      <div className="grid grid-cols-3 gap-2">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </div>

      {/* Budget card */}
      <Skeleton className="h-[132px] rounded-xl" />

      {/* Tag breakdown */}
      <Skeleton className="h-[168px] rounded-xl" />

      {/* Spending by category (pie + legend) */}
      <Skeleton className="h-[340px] rounded-xl" />

      {/* 6-month trend */}
      <Skeleton className="h-[288px] rounded-xl" />
    </div>
  );
}
