import { format, parse } from "date-fns";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { BudgetBar, BudgetRemaining } from "@/components/dashboard/budget-bar";
import { monthEndInIST, todayInIST } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import type { AssigneeBreakdown, LedgerSummary } from "@/lib/query";
import type { MemberOption } from "@/components/quick-add/types";

/**
 * Ledger summary header — one compact card describing exactly the filtered
 * set (month + member + category + tag + search). When no month is selected
 * it reports the all-time totals instead. Mirrors the dashboard's
 * expense-focused cards: total, lifestyle and the largest single spend.
 * Amendment 20 — when the filtered set contains uncategorized entries an
 * amber warning line links to the `category=uncategorized` view.
 * Layout pass — also absorbs the spent-vs-budget bar (previously a separate
 * block above it) so the ledger's chrome is ONE slim card, getting the first
 * transaction row into the opening viewport on mobile.
 */
export function LedgerSummaryHeader({
  monthKey,
  summary,
  breakdown,
  members,
  filtersQs = "",
  monthBudget = null,
}: {
  monthKey?: string;
  summary: LedgerSummary;
  /** §2.2 — assignment totals (combinations + per member) for the same set. */
  breakdown: AssigneeBreakdown;
  /** Household members, used to label the assignment groups. */
  members: MemberOption[];
  /** Serialized extra filter params (member/tag/q…) preserved on the link. */
  filtersQs?: string;
  /** §6.7 spent-vs-budget for the selected month; null when none/hidden. */
  monthBudget?: { spentPaise: number; budgetPaise: number; billsPaise: number; excludeBills: boolean } | null;
}) {
  const scope = monthKey ? format(parse(`${monthKey}-01`, "yyyy-MM-dd", new Date()), "MMMM yyyy") : "All time";
  const memberById = new Map(members.map((m) => [m.id, m]));

  /** Human label for one assignment combination. */
  function labelFor(ids: string[]): string {
    if (ids.length === 0) return "❔ Unassigned";
    const ordered = members.filter((m) => ids.includes(m.id));
    if (members.length > 0 && ordered.length === members.length) return "👨‍👩‍👧 Everyone";
    return ordered.map((m) => `${m.emoji} ${m.name}`).join(" + ");
  }
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
        {monthBudget && (
          <div className="mt-2 space-y-1 border-t pt-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-muted-foreground">Budget</span>
              <BudgetRemaining spent={monthBudget.spentPaise} budget={monthBudget.budgetPaise} />
            </div>
            <BudgetBar spent={monthBudget.spentPaise} budget={monthBudget.budgetPaise} />
            {monthBudget.excludeBills && monthBudget.billsPaise > 0 && (
              <p className="text-[11px] text-muted-foreground">excluding {formatINR(monthBudget.billsPaise)} in bills</p>
            )}
            {/* UX pass — mid-month pacing: what the remaining budget allows per
                day. Only meaningful for the CURRENT month; past months get no
                projection. */}
            {(() => {
              const today = todayInIST();
              if (!monthKey || monthKey !== today.slice(0, 7)) return null;
              const daysLeft = Number(monthEndInIST().slice(8, 10)) - Number(today.slice(8, 10)) + 1;
              if (daysLeft <= 0) return null;
              const remaining = monthBudget.budgetPaise - monthBudget.spentPaise;
              return remaining >= 0 ? (
                <p className="text-[11px] font-medium tabular-nums text-emerald-600">
                  ≈ {formatINR(Math.round(remaining / daysLeft))}/day safe · {daysLeft} {daysLeft === 1 ? "day" : "days"} left
                </p>
              ) : (
                <p className="text-[11px] font-medium tabular-nums text-red-600">
                  over by {formatINR(-remaining)} · {daysLeft} {daysLeft === 1 ? "day" : "days"} left
                </p>
              );
            })()}
          </div>
        )}
        {/* §2.2 — assignment totals for the same filtered set: each distinct
            combination, then per-member totals (shared spend counts for every
            member it is for). Collapsed by default to keep the card slim. */}
        {breakdown.groups.length > 0 && (
          <details className="mt-2 border-t pt-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              For whom? <span className="font-normal">· combinations &amp; per-member totals</span>
            </summary>
            <div className="mt-2 space-y-2">
              <ul className="space-y-1">
                {breakdown.groups.map((g) => (
                  <li key={g.memberIds.join(",") || "unassigned"} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate">{labelFor(g.memberIds)}</span>
                    <span className="shrink-0 tabular-nums">
                      {formatINR(g.paise)}
                      <span className="text-muted-foreground"> · {g.count}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {breakdown.perMember.length > 0 && (
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-[11px] font-medium text-muted-foreground">Per member (shared spend counts for each)</p>
                  <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {breakdown.perMember.map((p) => {
                      const m = memberById.get(p.memberId);
                      return (
                        <li key={p.memberId} className="text-xs">
                          {m ? `${m.emoji} ${m.name}` : "Member"}{" "}
                          <span className="font-semibold tabular-nums">{formatINR(p.paise)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 border-t pt-1 text-xs font-medium">
                <span>Total</span>
                <span className="tabular-nums">{formatINR(breakdown.totalPaise)}</span>
              </div>
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
