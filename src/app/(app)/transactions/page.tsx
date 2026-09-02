import { addMonths, format, parse } from "date-fns";
import { db } from "@/db";
import { getTransactionsPage, getPendingReviewCount } from "@/actions/transactions";
import { getReviewPage } from "@/actions/review";
import { getCategories, getMembers, getRecentCategoryIds } from "@/lib/meta";
import { FiltersBar } from "@/components/transactions/filters";
import { listSavedSearches } from "@/actions/saved-searches";
import { TransactionsList } from "@/components/transactions/transactions-list";
import { ExportButton } from "@/components/transactions/export-button";
import { ImportButton } from "@/components/transactions/import-dialog";
import { MonthStrip } from "@/components/transactions/month-strip";
import { LedgerSummaryHeader } from "@/components/transactions/ledger-summary";
import { ReviewQueueCard } from "@/components/review/review-queue-card";
import { monthKeyInIST } from "@/lib/dates";
import type { CategoryOption, MemberOption } from "@/components/quick-add/types";
import { getLedgerSummary } from "@/lib/query";
import { parseLedgerSearchParams } from "@/lib/ledger-url";
import { getMonthBudgetStatus } from "@/lib/budgets";
import { getExcludeBillsEnabled } from "@/db/app-settings-mutations";

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

  const [firstPage, memberRows, categoryRows, monthBudget, pendingReviewCount, reviewPage, recentCategoryIds, excludeBills, savedSearchesRes] = await Promise.all([
    getTransactionsPage({ cursor: null, filters }),
    getMembers(),
    getCategories(),
    // §6.7 — spent-vs-budget for the strip's selected month; null when no total budget
    filters.month ? getMonthBudgetStatus(db, filters.month) : Promise.resolve(null),
    // Amendment 20 — the Review queue lives on the Ledger page
    getPendingReviewCount(),
    getReviewPage({ cursor: null }),
    // Two-level picker — "Recent" chips for the category pickers
    getRecentCategoryIds(),
    // §1.10 — the global exclude-bills toggle, so the ledger headline can
    // agree with the budget bar.
    getExcludeBillsEnabled(db),
    // §2.7 — saved search presets for the filter bar's one-tap chips
    listSavedSearches(),
  ]);
  const summary = await getLedgerSummary(filters, excludeBills);

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
    parentId: c.parentId,
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
        {/* UX pass — exports describe exactly the filtered set on screen.
            §2.10 — export is a format menu (CSV / 7-column CSV / JSON / XLSX)
            and import is the way back in, so backup is no longer one-way. */}
        <div className="flex items-center gap-1">
          <ImportButton />
          <ExportButton filters={filters} />
        </div>
      </div>
      <MonthStrip months={stripMonths} selected={filters.month} filters={ledgerFilters} />
      {/* Layout pass — budget bar lives inside the summary card now, so the
          ledger's chrome is one slim strip and rows start higher. */}
      <LedgerSummaryHeader monthKey={filters.month} summary={summary} filtersQs={filtersQs} monthBudget={filters.month ? monthBudget : null} />
      {/* Amendment 20 — the Review queue is pinned to the top of the Ledger */}
      {pendingReviewCount > 0 && (
        <ReviewQueueCard
          initialRows={reviewPage.rows}
          nextCursor={reviewPage.nextCursor}
          pendingCount={pendingReviewCount}
          members={memberOptions}
          categories={categoryOptions}
          recentCategoryIds={recentCategoryIds}
        />
      )}
      <FiltersBar
        members={memberOptions}
        categories={categoryOptions}
        filters={ledgerFilters}
        savedSearches={savedSearchesRes.ok ? savedSearchesRes.searches : []}
      />
      {/* remount on filter change so client state resets to the new server page */}
      <TransactionsList
        key={JSON.stringify(filters)}
        initialRows={firstPage.rows}
        initialCursor={firstPage.nextCursor}
        filters={filters}
        members={memberOptions}
        categories={categoryOptions}
        recentCategoryIds={recentCategoryIds}
      />
    </div>
  );
}
