import Link from "next/link";
import { unstable_cache } from "next/cache";
import { addMonths, format, parse } from "date-fns";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { getExcludeBillsEnabled } from "@/db/app-settings-mutations";
import { categories, transactions } from "@/db/schema";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { monthEndInIST, monthKeyInIST, todayInIST } from "@/lib/dates";
import { getCategories, getMembers } from "@/lib/meta";
import { getTransactionsPage } from "@/actions/transactions";
import { budgetsForMonth, resolveEffectiveBudget } from "@/lib/budgets";
import { cn } from "@/lib/utils";
import { MonthPicker } from "@/components/dashboard/month-picker";
import { BudgetCard } from "@/components/dashboard/budget-card";
import { BudgetBar } from "@/components/dashboard/budget-bar";
import { CategoryPie, TagBar, TrendChart } from "@/components/dashboard/charts";
import { TransactionsList } from "@/components/transactions/transactions-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * All dashboard analytics are SQL aggregates (§7.2), fetched in as few round
 * trips as possible (totals + tag breakdown share one FILTER query) and cached
 * per month under the "transactions" tag — every mutation revalidates that
 * tag, so the cache is always invalidated on change.
 */
const getDashboardData = unstable_cache(
  async (monthKey: string) => {
    const start = `${monthKey}-01`;
    const baseDate = parse(`${monthKey}-01`, "yyyy-MM-dd", new Date());
    const end = monthEndInIST(baseDate);
    const range = and(gte(transactions.date, start), lte(transactions.date, end));

    const [totalsTags, catRows, prevCatRows, trendRows, largestRows, budgetRows] = await Promise.all([
      // expense + all three expense tags in a single pass over the month
      db
        .select({
          expense: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
          recurring: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.tag} = 'recurring'), 0)`,
          recurringCount: sql<number>`COUNT(*) FILTER (WHERE ${transactions.tag} = 'recurring')::int`,
          lifestyle: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.tag} = 'lifestyle'), 0)`,
          oneTime: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.tag} = 'one_time'), 0)`,
        })
        .from(transactions)
        .where(range),
      db
        .select({
          id: categories.id,
          name: categories.name,
          emoji: categories.emoji,
          color: categories.color,
          total: sql<string>`SUM(${transactions.amount})`,
        })
        .from(transactions)
        // Amendment 20 — left join so uncategorized spend appears as its own slice
        .leftJoin(categories, eq(transactions.categoryId, categories.id))
        .where(and(gte(transactions.date, start), lte(transactions.date, end)))
        .groupBy(categories.id, categories.name, categories.emoji, categories.color),
      // UX pass — same shape for the previous month, for per-category MoM deltas
      db
        .select({
          id: categories.id,
          total: sql<string>`SUM(${transactions.amount})`,
        })
        .from(transactions)
        .leftJoin(categories, eq(transactions.categoryId, categories.id))
        .where(
          and(
            gte(transactions.date, `${format(addMonths(baseDate, -1), "yyyy-MM")}-01`),
            lte(transactions.date, monthEndInIST(addMonths(baseDate, -1))),
          ),
        )
        .groupBy(categories.id),
      db
        .select({
          month: sql<string>`substring(${transactions.date}::text from 1 for 7)`,
          total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
        })
        .from(transactions)
        .where(gte(transactions.date, `${format(addMonths(baseDate, -5), "yyyy-MM")}-01`))
        .groupBy(sql`substring(${transactions.date}::text from 1 for 7)`),
      // Largest single expense this month — for the summary card
      db
        .select({
          amount: transactions.amount,
          note: transactions.note,
          categoryId: categories.id,
          categoryName: categories.name,
          categoryEmoji: categories.emoji,
          categoryColor: categories.color,
        })
        .from(transactions)
        .leftJoin(categories, eq(transactions.categoryId, categories.id))
        .where(and(gte(transactions.date, start), lte(transactions.date, end)))
        .orderBy(desc(transactions.amount))
        .limit(1),
      // §6.7 budgets — exact-month rows plus the every-month defaults, resolved below
      budgetsForMonth(db, monthKey),
    ]);

    const totals = totalsTags[0];
    const expensePaise = rupeesToPaise(totals.expense);

    // §6.7 — effective budget for the month: exact-month row wins, else the default.
    const effectiveBudget = (categoryId: string | null) => resolveEffectiveBudget(budgetRows, monthKey, categoryId);
    const totalBudget = effectiveBudget(null);
    // One entry per category with a limit — resolve the effective paise per
    // category, deduplicated (the exact-month and default rows share the id).
    const categoryBudgetRows = Array.from(
      new Map(
        budgetRows
          .filter((b) => b.categoryId !== null)
          .map((b) => [
            b.categoryId!,
            {
              categoryId: b.categoryId!,
              name: b.categoryName ?? "",
              emoji: b.categoryEmoji ?? "",
              color: b.categoryColor ?? "",
              paise: rupeesToPaise(effectiveBudget(b.categoryId)?.amount ?? "0"),
            },
          ]),
      ).values(),
    ).filter((b) => b.paise > 0);

    // Amendment 20 — the "Top category" insight ignores uncategorized spend;
    // the pie chart below still shows it as an explicit gray slice.
    const topCategory = catRows.reduce<typeof catRows[number] | null>(
      (best, r) => (r.id === null ? best : best === null || rupeesToPaise(r.total) > rupeesToPaise(best.total) ? r : best),
      null,
    );
    const largest = largestRows[0];

    const tags = [
      { key: "lifestyle", label: "Lifestyle", paise: rupeesToPaise(totals.lifestyle), color: "#0ea5e9" },
      { key: "recurring", label: "Bills", paise: rupeesToPaise(totals.recurring), color: "#8b5cf6" },
      { key: "one_time", label: "One-time buys", paise: rupeesToPaise(totals.oneTime), color: "#f59e0b" },
    ] as const;

    // §6.3.1: months with no data plot as 0, not a gap — the axis stays continuous.
    const trendKeys = Array.from({ length: 6 }, (_, i) => format(addMonths(baseDate, i - 5), "yyyy-MM"));
    const trendMap = new Map(trendRows.map((r) => [r.month, r]));
    const trend = trendKeys.map((k) => {
      const r = trendMap.get(k);
      return {
        label: format(parse(`${k}-01`, "yyyy-MM-dd", new Date()), "MMM"),
        expensePaise: r ? rupeesToPaise(r.total) : 0,
      };
    });

    return {
      expensePaise,
      billsPaise: rupeesToPaise(totals.recurring),
      billsCount: Number(totals.recurringCount),
      lifestylePaise: rupeesToPaise(totals.lifestyle),
      topCategory: topCategory
        ? { id: topCategory.id, name: topCategory.name, emoji: topCategory.emoji, color: topCategory.color, paise: rupeesToPaise(topCategory.total) }
        : null,
      largestSpend: largest
        ? { amountPaise: rupeesToPaise(largest.amount), note: largest.note, categoryId: largest.categoryId, categoryName: largest.categoryName, categoryEmoji: largest.categoryEmoji }
        : null,
      budget: {
        totalPaise: totalBudget ? rupeesToPaise(totalBudget.amount) : null,
        categories: categoryBudgetRows,
      },
      tags,
      catRows,
      // UX pass — previous-month totals keyed by category id (null = uncategorized)
      // for the pie legend's MoM delta chips.
      catPrev: Object.fromEntries(prevCatRows.map((r) => [String(r.id), rupeesToPaise(r.total)])) as Record<string, number>,
      trend,
    };
  },
  ["family-ledger", "dashboard"],
  { tags: ["transactions"], revalidate: 60 },
);

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const monthKey = typeof sp.month === "string" && MONTH_RE.test(sp.month) ? sp.month : monthKeyInIST();
  const [data, firstPage, memberRows, categoryRows, excludeBills] = await Promise.all([
    getDashboardData(monthKey),
    getTransactionsPage({ cursor: null, filters: { month: monthKey } }),
    getMembers(),
    getCategories(),
    // §6.7 — global toggle, read outside the cache so flipping it needs no cache key change
    getExcludeBillsEnabled(db),
  ]);
  const memberOptions = memberRows.map((m) => ({
    id: m.id, slug: m.slug, name: m.name, emoji: m.emoji, color: m.color, sortOrder: m.sortOrder,
  }));
  const categoryOptions = categoryRows.map((c) => ({
    id: c.id, slug: c.slug, name: c.name, emoji: c.emoji, color: c.color, sortOrder: c.sortOrder, parentId: c.parentId,
  }));
  // Per-category spend for the budget card's category rows (§6.7)
  const catSpentPaise = new Map(data.catRows.map((r) => [r.id, rupeesToPaise(r.total)]));

  // UX pass — month-over-month direction for the hero, from the trend series
  // already fetched (index 4 = last month, 5 = this month).
  const prevTrend = data.trend[data.trend.length - 2];
  const momDelta =
    prevTrend && prevTrend.expensePaise > 0
      ? ((data.expensePaise - prevTrend.expensePaise) / prevTrend.expensePaise) * 100
      : null;
  const prevMonthLabel = format(addMonths(parse(`${monthKey}-01`, "yyyy-MM-dd", new Date()), -1), "MMM");

  // UX pass — pacing context for the budget card. Computed on the server from
  // IST "today" (never new Date() on the client — §5.7) so hydration matches.
  // Only meaningful for the running month; past/future months get no line.
  const todayKey = todayInIST();
  const [py, pm] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const pacing =
    monthKey === monthKeyInIST()
      ? { dayOfMonth: Number(todayKey.slice(8, 10)), daysInMonth }
      : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Overview</h1>
        <MonthPicker month={monthKey} />
      </div>

      {/* Layout pass — money state first: a full-width Expense hero (largest
          spend folded in as its subline), then a compact 3-up row. The old
          2-col grid orphaned its fifth tile and buried the budget below four
          chart cards. */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">Expense · {format(parse(`${monthKey}-01`, "yyyy-MM-dd", new Date()), "MMMM yyyy")}</p>
            <Link href={`/transactions?month=${monthKey}`} className="text-[11px] text-muted-foreground hover:text-foreground hover:underline">
              View in Ledger →
            </Link>
          </div>
          <p className="mt-1 truncate text-3xl font-semibold tabular-nums text-red-600">{formatINR(data.expensePaise)}</p>
          {momDelta !== null && (
            <p
              className={cn(
                "mt-0.5 text-xs font-medium tabular-nums",
                momDelta > 0 ? "text-red-600" : momDelta < 0 ? "text-emerald-600" : "text-muted-foreground",
              )}
            >
              {momDelta > 0 ? "▲" : momDelta < 0 ? "▼" : "—"} {Math.abs(momDelta).toFixed(0)}% vs {prevMonthLabel}
            </p>
          )}
          {data.largestSpend && (
            <Link
              href={`/transactions?month=${monthKey}${data.largestSpend.categoryId ? `&category=${data.largestSpend.categoryId}` : "&category=uncategorized"}&q=${encodeURIComponent(data.largestSpend.note ?? "")}`}
              className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <span aria-hidden>↳</span>
              <span className="truncate">
                Largest {formatINR(data.largestSpend.amountPaise)} · {data.largestSpend.note || data.largestSpend.categoryName || "Uncategorized"}
              </span>
            </Link>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <Link href={data.topCategory ? `/transactions?month=${monthKey}&category=${data.topCategory.id}` : `/transactions?month=${monthKey}`} className="block active:scale-[0.98] transition-transform">
          <Card>
            <CardContent className="p-2.5">
              <p className="text-[11px] leading-tight text-muted-foreground">Top category</p>
              {data.topCategory ? (
                <>
                  <p className="mt-0.5 truncate text-sm font-semibold tabular-nums sm:text-base">{data.topCategory.emoji} {formatINR(data.topCategory.paise)}</p>
                  <p className="truncate text-[10px] text-muted-foreground sm:text-xs">{data.topCategory.name}</p>
                </>
              ) : (
                <p className="mt-0.5 text-sm font-semibold text-muted-foreground sm:text-base">—</p>
              )}
            </CardContent>
          </Card>
        </Link>
        <Link href={`/transactions?month=${monthKey}&tag=recurring`} className="block active:scale-[0.98] transition-transform">
          <Card>
            <CardContent className="p-2.5">
              <p className="text-[11px] leading-tight text-muted-foreground">Bills</p>
              <p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-[#8b5cf6] sm:text-base">{formatINR(data.billsPaise)}</p>
              <p className="truncate text-[10px] text-muted-foreground sm:text-xs">
                {data.billsCount > 0 ? `${data.billsCount} recurring` : "none"}
              </p>
            </CardContent>
          </Card>
        </Link>
        <Link href={`/transactions?month=${monthKey}&tag=lifestyle`} className="block active:scale-[0.98] transition-transform">
          <Card>
            <CardContent className="p-2.5">
              <p className="text-[11px] leading-tight text-muted-foreground">Lifestyle</p>
              <p className="mt-0.5 truncate text-sm font-semibold tabular-nums sm:text-base">{formatINR(data.lifestylePaise)}</p>
              <p className="truncate text-[10px] text-muted-foreground sm:text-xs">discretionary</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Budget card (§6.7) — total spent vs the effective budget, with inline edit/clear */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Budget</CardTitle>
        </CardHeader>
        <CardContent>
          <BudgetCard
            monthKey={monthKey}
            totalPaise={data.budget.totalPaise}
            expensePaise={data.expensePaise}
            billsPaise={data.billsPaise}
            excludeBills={excludeBills}
            hasCategoryBudgets={data.budget.categories.length > 0}
            pacing={pacing}
          />
        </CardContent>
      </Card>

      {/* Tag breakdown (§6.3) — denominator is total expense */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Tag breakdown</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.tags.map((t) => (
            <TagBar key={t.key} label={t.label} paise={t.paise} totalExpense={data.expensePaise} color={t.color} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Spending by category</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <CategoryPie
            slices={data.catRows.map((r) => ({
              name: r.name ?? "Uncategorized",
              emoji: r.emoji ?? "❔",
              color: r.color ?? "#9ca3af",
              paise: rupeesToPaise(r.total),
              prevPaise: data.catPrev[String(r.id)] ?? 0,
            }))}
          />
          {/* §6.7 — per-category budget bars live with the category spend */}
          {data.budget.categories.length > 0 && (
            <ul className="space-y-2 border-t pt-2">
              {data.budget.categories.map((cb) => {
                const spent = catSpentPaise.get(cb.categoryId) ?? 0;
                return (
                  <li key={cb.categoryId} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="truncate">
                        {cb.emoji} {cb.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatINR(spent)} / {formatINR(cb.paise)}
                      </span>
                    </div>
                    <BudgetBar spent={spent} budget={cb.paise} className="h-1" />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">6-month trend</CardTitle>
        </CardHeader>
        <CardContent>
          <TrendChart points={data.trend} />
        </CardContent>
      </Card>

      {/* Month-wise transactions panel — tap a row to edit, swipe to delete */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm">Transactions</CardTitle>
          <Link href={`/transactions?month=${monthKey}`} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
            View all in Ledger
          </Link>
        </CardHeader>
        <CardContent>
          <TransactionsList
            key={`dashboard-${monthKey}`}
            initialRows={firstPage.rows}
            initialCursor={firstPage.nextCursor}
            filters={{ month: monthKey }}
            members={memberOptions}
            categories={categoryOptions}
          />
        </CardContent>
      </Card>
    </div>
  );
}


