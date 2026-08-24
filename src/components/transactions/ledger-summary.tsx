import { format, parse } from "date-fns";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { formatINR } from "@/lib/money";
import type { LedgerSummary } from "@/lib/query";

/**
 * Ledger summary header — one compact card describing exactly the filtered
 * set (month + member + category + tag + search). When no month is selected
 * it reports the all-time totals instead. Mirrors the dashboard's
 * expense-focused cards: total, lifestyle and the largest single spend.
 * Amendment 20 — when the filtered set contains uncategorized entries a
 * warning line links to the `category=uncategorized` view.
 */
export function LedgerSummaryHeader({
  monthKey,
  summary,
  filtersQs = "",
}: {
  monthKey?: string;
  summary: LedgerSummary;
  /** Serialized extra filter params (member/tag/q…) preserved on the link. */
  filtersQs?: string;
}) {
  const scope = monthKey ? format(parse(`${monthKey}-01`, "yyyy-MM-dd", new Date()), "MMMM yyyy") : "All time";
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{scope}</p>
          <p className="text-xs text-muted-foreground">
            {summary.count.toLocaleString("en-IN")} {summary.count === 1 ? "entry" : "entries"}
          </p>
        </div>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          <div>
            <p className="text-xs text-muted-foreground">Expense</p>
            <p className="truncate text-base font-semibold tabular-nums text-red-600">{formatINR(summary.expensePaise)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Lifestyle spend</p>
            <p className="truncate text-base font-semibold tabular-nums">{formatINR(summary.lifestylePaise)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Largest spend</p>
            {summary.largestPaise !== null ? (
              <p className="truncate text-base font-semibold tabular-nums text-red-600">{formatINR(summary.largestPaise)}</p>
            ) : (
              <p className="truncate text-base font-semibold text-muted-foreground">—</p>
            )}
          </div>
        </div>
        {summary.uncategorizedCount > 0 && (
          <Link
            href={`/transactions?${filtersQs ? `${filtersQs}&` : ""}category=uncategorized`}
            className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
          >
            <span>❔ {summary.uncategorizedCount} uncategorized</span>
            <span className="tabular-nums">{formatINR(summary.uncategorizedPaise)} — review →</span>
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
