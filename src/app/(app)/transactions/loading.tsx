import { Skeleton } from "@/components/ui/skeleton";

/** UX pass — ledger-shaped loading: title, month strip, summary card, filter
 * rows, then transaction rows. Heights track the real page so the handoff
 * doesn't jump. */
export default function TransactionsLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-9 w-24 rounded-full" />
      </div>

      {/* month strip */}
      <div className="flex gap-1.5 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-14 shrink-0 rounded-full" />
        ))}
      </div>

      {/* summary card */}
      <Skeleton className="h-28 rounded-xl" />

      {/* filters: search + pill row */}
      <div className="space-y-2">
        <Skeleton className="h-9 rounded-lg" />
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 shrink-0 rounded-full" />
          ))}
        </div>
      </div>

      {/* transaction rows */}
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[60px] rounded-xl" />
        ))}
      </div>
    </div>
  );
}
