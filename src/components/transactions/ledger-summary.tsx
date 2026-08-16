import { format, parse } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { formatINR } from "@/lib/money";
import type { LedgerSummary } from "@/lib/query";

/**
 * Ledger summary header — one compact card describing exactly the filtered
 * set (month + member + category + tag + search). When no month is selected
 * it reports the all-time totals instead. Mirrors the dashboard's
 * expense-focused cards: total, lifestyle and the largest single spend.
 */
export function LedgerSummaryHeader({ monthKey, summary }: { monthKey?: string; summary: LedgerSummary }) {
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
      </CardContent>
    </Card>
  );
}
