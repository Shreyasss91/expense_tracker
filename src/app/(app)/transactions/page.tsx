import { addMonths, format, parse } from "date-fns";
import { db } from "@/db";
import { getTransactionsPage, getPendingReviewCount } from "@/actions/transactions";
import { getReviewPage } from "@/actions/review";
import { getCategories, getMembers } from "@/lib/meta";
import { FiltersBar } from "@/components/transactions/filters";
import { TransactionsList } from "@/components/transactions/transactions-list";
import { ExportButton } from "@/components/transactions/export-button";
import { MonthStrip } from "@/components/transactions/month-strip";
import { LedgerSummaryHeader } from "@/components/transactions/ledger-summary";
import { ReviewQueueCard } from "@/components/review/review-queue-card";
import { monthKeyInIST } from "@/lib/dates";
import type { CategoryOption, MemberOption } from "@/components/quick-add/types";
import { getLedgerSummary } from "@/lib/query";
import { parseLedgerSearchParams } from "@/lib/ledger-url";
import { getMonthBudgetStatus } from "@/lib/budgets";
import { BudgetBar, BudgetRemaining } from "@/components/dashboard/budget-bar";
import { formatINR } from "@/lib/money";

export const metadata = { title: "Ledger — Family Ledger" };

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  // §6.4 — the authoritative parse; the same filter objects drive the list
  // query, the summary query and the URL-building controls.
  const { filters, ledgerFilters } = parseLedgerSearchParams(sp);

  // §5.7: the strip window is derived from the current IST month and covers the
  // whole seeded history (36 months); "All" reaches anything older.
  const stripBase = parse(`${monthKeyInIST()}-01`, "yyyy-MM-dd", new Date());
  const stripMonths = Array.from({ length: 36 }, (_, i) => format(addMonths(stripBase, i - 35), "yyyy-MM"));

  const [firstPage, summary, memberRows, categoryRows, monthBudget, pendingReviewCount, reviewPage] = await Promise.all([
    getTransactionsPage({ cursor: null, filters }),
    getLedgerSummary(filters),
    getMembers(),
    getCategories(),
    // §6.7 — spent-vs-budget for the strip's selected month; null when no total budget
    filters.month ? getMonthBudgetStatus(db, filters.month) : Promise.resolve(null),
    // Amendment 20 — the Review queue lives on the Ledger page
    getPendingReviewCount(),
    getReviewPage({ cursor: null }),
  ]);

  const memberOptions: MemberOption[] = memberRows.map((m) => ({
    id: m.id,
    slug: m.slug,
    name: m.name,
    emoji: m.emoji,
    color: m.color,
    sortOrder: m.sortOrder,
  }));
  const categoryOptions: CategoryOption[] = categoryRows.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    emoji: c.emoji,
    color: c.color,
    sortOrder: c.sortOrder,
  }));

  // Scope params preserved on the summary's "uncategorized" deep link (the
  // category param itself is replaced by category=uncategorized).
  const scopeQs = new URLSearchParams();
  if (ledgerFilters.memberId) scopeQs.set("member", ledgerFilters.memberId);
  if (ledgerFilters.tag) scopeQs.set("tag", ledgerFilters.tag);
  if (ledgerFilters.month) scopeQs.set("month", ledgerFilters.month);
  if (ledgerFilters.q?.trim()) scopeQs.set("q", ledgerFilters.q.trim());
  const filtersQs = scopeQs.toString();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Ledger</h1>
        <ExportButton />
      </div>
      <MonthStrip months={stripMonths} selected={filters.month} filters={ledgerFilters} />
      {/* §6.7 — spent-vs-budget bar for the selected month; shown only when a total budget is set */}
      {filters.month && monthBudget && (
        <div className="space-y-1.5 px-0.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-muted-foreground">
              {format(parse(`${filters.month}-01`, "yyyy-MM-dd", new Date()), "MMMM")} budget
            </span>
            <BudgetRemaining spent={monthBudget.spentPaise} budget={monthBudget.budgetPaise} />
          </div>
          <BudgetBar spent={monthBudget.spentPaise} budget={monthBudget.budgetPaise} />
          {monthBudget.excludeBills && monthBudget.billsPaise > 0 && (
            <p className="text-[11px] text-muted-foreground">excluding {formatINR(monthBudget.billsPaise)} in bills</p>
          )}
        </div>
      )}
      <LedgerSummaryHeader monthKey={filters.month} summary={summary} filtersQs={filtersQs} />
      {/* Amendment 20 — the Review queue is pinned to the top of the Ledger */}
      {pendingReviewCount > 0 && (
        <ReviewQueueCard
          initialRows={reviewPage.rows}
          nextCursor={reviewPage.nextCursor}
          pendingCount={pendingReviewCount}
          members={memberOptions}
          categories={categoryOptions}
        />
      )}
      <FiltersBar members={memberOptions} categories={categoryOptions} filters={ledgerFilters} />
      {/* remount on filter change so client state resets to the new server page */}
      <TransactionsList
        key={JSON.stringify(filters)}
        initialRows={firstPage.rows}
        initialCursor={firstPage.nextCursor}
        filters={filters}
        members={memberOptions}
        categories={categoryOptions}
      />
    </div>
  );
}
