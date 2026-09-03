import Link from "next/link";
import { unstable_cache } from "next/cache";
import { addMonths, format, parse } from "date-fns";
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { getExcludeBillsEnabled } from "@/db/app-settings-mutations";
import { categories, transactions } from "@/db/schema";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { monthEndInIST, monthKeyInIST, todayInIST } from "@/lib/dates";
import { getCategories, getMembers, getRecentCategoryIds } from "@/lib/meta";
import { getTransactionsPage } from "@/actions/transactions";
import { budgetsForMonth, resolveEffectiveBudget, resolveGroupBudget } from "@/lib/budgets";
import { getRecurringSuggestions, type RecurringSuggestion } from "@/lib/recurring-detection";
import { computeInsights } from "@/lib/insights";
import { cn } from "@/lib/utils";
import { MonthPicker } from "@/components/dashboard/month-picker";
import { BudgetCard } from "@/components/dashboard/budget-card";
import { BudgetBar } from "@/components/dashboard/budget-bar";
import { CategoryPie, TagBar, TrendChart } from "@/components/dashboard/charts";
import { CompareMatrix } from "@/components/dashboard/compare-matrix";
import { TransactionsList } from "@/components/transactions/transactions-list";
import { RecurringSuggestions } from "@/components/dashboard/recurring-suggestions";
import { InsightsCard } from "@/components/dashboard/insights-card";
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
    // §2.8 — trailing 6-month window for per-category averages
    const since = format(addMonths(baseDate, -5), "yyyy-MM-01");
    // Two-level hierarchy — every leaf carries its group's display fields so
    // the pie can roll spend up client-side (and drill back down) with no
    // extra round trip.
    const parentCategories = alias(categories, "parent_categories");

    const [totalsTags, catRows, prevCatRows, trendRows, largestRows, budgetRows, uncatAgg, catMonthly, catRecord, catMonthMax] = await Promise.all([
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
          parentId: categories.parentId,
          groupName: parentCategories.name,
          groupEmoji: parentCategories.emoji,
          groupColor: parentCategories.color,
          total: sql<string>`SUM(${transactions.amount})`,
        })
        .from(transactions)
        // Amendment 20 — left join so uncategorized spend appears as its own slice
        .leftJoin(categories, eq(transactions.categoryId, categories.id))
        .leftJoin(parentCategories, eq(categories.parentId, parentCategories.id))
        .where(and(gte(transactions.date, start), lte(transactions.date, end)))
        .groupBy(categories.id, categories.name, categories.emoji, categories.color, categories.parentId, parentCategories.name, parentCategories.emoji, parentCategories.color),
      // UX pass — same shape for the previous month, for per-category MoM deltas
      db
        .select({
          id: categories.id,
          parentId: categories.parentId,
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
        .groupBy(categories.id, categories.parentId),
      db
        .select({
          month: sql<string>`substring(${transactions.date}::text from 1 for 7)`,
          total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
        })
        .from(transactions)
        .where(
          and(
            gte(transactions.date, `${format(addMonths(baseDate, -5), "yyyy-MM")}-01`),
            // §1.9 — upper bound: a single future-dated row must not widen the
            // scan indefinitely. Cap at the end of the selected month.
            lte(transactions.date, monthEndInIST(baseDate)),
          ),
        )
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
      // §2.8 — uncategorized count + sum this month (promoted insight)
      db
        .select({
          count: sql<number>`COUNT(*)`,
          total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
        })
        .from(transactions)
        .where(and(gte(transactions.date, start), lte(transactions.date, end), isNull(transactions.categoryId))),
      // §2.8 — per (category, month) sums over the trailing 6 months, for the
      // "above your 6-month average" check
      db
        .select({
          categoryId: sql<string>`${transactions.categoryId}`,
          month: sql<string>`substring(${transactions.date}::text from 1 for 7)`,
          total: sql<string>`SUM(${transactions.amount})`,
        })
        .from(transactions)
        .where(and(gte(transactions.date, since), lte(transactions.date, end), sql`${transactions.categoryId} IS NOT NULL`))
        .groupBy(transactions.categoryId, sql`substring(${transactions.date}::text from 1 for 7)`),
      // §2.8 — all-time largest single transaction per category (record)
      db
        .select({
          categoryId: sql<string>`${transactions.categoryId}`,
          max: sql<string>`MAX(${transactions.amount})`,
        })
        .from(transactions)
        .where(sql`${transactions.categoryId} IS NOT NULL`)
        .groupBy(transactions.categoryId),
      // §2.8 — largest single transaction per category this month (for the
      // "close to your record" check)
      db
        .select({
          categoryId: sql<string>`${transactions.categoryId}`,
          max: sql<string>`MAX(${transactions.amount})`,
        })
        .from(transactions)
        .where(and(gte(transactions.date, start), lte(transactions.date, end), sql`${transactions.categoryId} IS NOT NULL`))
        .groupBy(transactions.categoryId),
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

    // §2.1 — group budgets: resolve each group's effective limit (exact-month
    // row wins, else the every-month default) and keep only groups that have a
    // non-zero limit set. Spend for the group is the roll-up of its leaves,
    // computed client-side in the page from catRows (below).
    const groupLimitMap = new Map<string, number>();
    for (const b of budgetRows) {
      if (b.groupId) {
        const eff = resolveGroupBudget(budgetRows, monthKey, b.groupId);
        if (eff) groupLimitMap.set(b.groupId, rupeesToPaise(eff.amount));
      }
    }
    const groupBudgets = Array.from(groupLimitMap, ([groupId, limitPaise]) => ({ groupId, limitPaise })).filter(
      (g) => g.limitPaise > 0,
    );

    // Amendment 20 — the "Top category" insight ignores uncategorized spend;
    // the pie chart below still shows it as an explicit gray slice.
    const topCategory = catRows.reduce<typeof catRows[number] | null>(
      (best, r) => (r.id === null ? best : best === null || rupeesToPaise(r.total) > rupeesToPaise(best.total) ? r : best),
      null,
    );
    const largest = largestRows[0];

    // §3.7 — tag colours read the chart tokens instead of hex literals, so
    // dark mode gets its lifted palette too.
    const tags = [
      { key: "lifestyle", label: "Lifestyle", paise: rupeesToPaise(totals.lifestyle), color: "var(--chart-1)" },
      { key: "recurring", label: "Bills", paise: rupeesToPaise(totals.recurring), color: "var(--chart-2)" },
      { key: "one_time", label: "One-time buys", paise: rupeesToPaise(totals.oneTime), color: "var(--chart-3)" },
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

    // §2.12 — category × month matrix ("is fuel creeping up?"). Reuses the
    // trailing-6mo per-category sums already fetched for insights.
    const compareMonths = trendKeys.map((k) => ({
      key: k,
      label: format(parse(`${k}-01`, "yyyy-MM-dd", new Date()), "MMM"),
    }));
    const compareByCat = new Map<string, { months: Record<string, number>; total: number }>();
    for (const r of catMonthly) {
      const id = String(r.categoryId);
      const paise = rupeesToPaise(r.total);
      const slot = compareByCat.get(id) ?? { months: {}, total: 0 };
      slot.months[r.month] = (slot.months[r.month] ?? 0) + paise;
      slot.total += paise;
      compareByCat.set(id, slot);
    }
    const catNameById = new Map(catRows.map((r) => [String(r.id), r]));
    const compareRows = Array.from(compareByCat.entries()).map(([id, v]) => {
      const meta = catNameById.get(id);
      return {
        id,
        name: meta?.name ?? "Uncategorized",
        emoji: meta?.emoji ?? "❔",
        months: v.months,
        total: v.total,
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
        groups: groupBudgets,
      },
      tags,
      catRows,
      // UX pass — previous-month totals keyed by category id (null = uncategorized)
      // for the pie legend's MoM delta chips.
      catPrev: Object.fromEntries(prevCatRows.map((r) => [String(r.id), rupeesToPaise(r.total)])) as Record<string, number>,
      trend,
      compareMonths,
      compareRows,
      // §2.8 — diagnostic insights derived from the aggregates above
      insights: computeInsights({
        monthKey,
        catRows,
        catPrev: Object.fromEntries(prevCatRows.map((r) => [String(r.id), rupeesToPaise(r.total)])) as Record<string, number>,
        uncat: uncatAgg[0] ?? null,
        catMonthly,
        catRecord,
        catMonthMax,
      }),
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
  const [data, firstPage, memberRows, categoryRows, excludeBills, recentCategoryIds] = await Promise.all([
    getDashboardData(monthKey),
    getTransactionsPage({ cursor: null, filters: { month: monthKey } }),
    getMembers(),
    getCategories(),
    // §6.7 — global toggle, read outside the cache so flipping it needs no cache key change
    getExcludeBillsEnabled(db),
    // Two-level picker — "Recent" chips for the ledger's category pickers
    getRecentCategoryIds(),
  ]);

  // §2.4 — mine the ledger for recurring-bill clusters. Guarded: a detection
  // hiccup must never take the whole dashboard down with it.
  let recurring: RecurringSuggestion[] = [];
  try {
    recurring = await getRecurringSuggestions();
  } catch {
    recurring = [];
  }
  const memberOptions = memberRows.map((m) => ({
    id: m.id, slug: m.slug, name: m.name, emoji: m.emoji, color: m.color, sortOrder: m.sortOrder,
  }));
  const categoryOptions = categoryRows.map((c) => ({
    id: c.id, slug: c.slug, name: c.name, emoji: c.emoji, color: c.color, sortOrder: c.sortOrder, parentId: c.parentId,
  }));
  // Per-category spend for the budget card's category rows (§6.7)
  const catSpentPaise = new Map(data.catRows.map((r) => [r.id, rupeesToPaise(r.total)]));
  // §2.1 — group budgets: roll each group's leaves up to a spent total, then
  // build the cards from the resolved limits + per-leaf split underneath.
  const groupLimitById = new Map(data.budget.groups.map((g) => [g.groupId, g.limitPaise]));
  const groupSpentPaise = new Map<string, number>();
  for (const groupId of groupLimitById.keys()) groupSpentPaise.set(groupId, 0);
  for (const r of data.catRows) {
    if (r.parentId && groupSpentPaise.has(r.parentId)) {
      groupSpentPaise.set(r.parentId, (groupSpentPaise.get(r.parentId) ?? 0) + rupeesToPaise(r.total));
    }
  }
  const groupBudgetCards = Array.from(groupLimitById.entries()).map(([groupId, limitPaise]) => {
    const group = categoryOptions.find((c) => c.id === groupId);
    const leaves = data.catRows.filter((r) => r.parentId === groupId);
    return {
      groupId,
      name: group?.name ?? "Group",
      emoji: group?.emoji ?? "🧺",
      color: group?.color ?? "var(--chart-1)",
      limitPaise,
      spentPaise: groupSpentPaise.get(groupId) ?? 0,
      leaves: leaves.map((l) => ({ id: l.id, name: l.name ?? "", emoji: l.emoji ?? "", paise: rupeesToPaise(l.total) })),
    };
  });

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
              <p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-[var(--chart-2)] sm:text-base">{formatINR(data.billsPaise)}</p>
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

      {/* §2.4 — mined recurring-bill suggestions as one-tap template prompts */}
      <RecurringSuggestions suggestions={recurring} />

      {/* §2.8 — diagnostic insights: hot categories, uncategorized, record
          closeness, biggest MoM mover. Promoted high so the household sees
          what to look at, not just descriptive totals. */}
      <InsightsCard insights={data.insights} />

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
            month={monthKey}
            leaves={data.catRows.map((r) => ({
              id: r.id,
              name: r.name ?? "Uncategorized",
              emoji: r.emoji ?? "❔",
              color: r.color ?? "var(--chart-1)",
              paise: rupeesToPaise(r.total),
              prevPaise: data.catPrev[String(r.id)] ?? 0,
              parentId: r.parentId,
              groupName: r.groupName ?? undefined,
              groupEmoji: r.groupEmoji ?? undefined,
              groupColor: r.groupColor ?? undefined,
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

      {groupBudgetCards.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Group budgets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {groupBudgetCards.map((g) => (
              <div key={g.groupId} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="truncate font-semibold" style={{ color: g.color }}>
                    {g.emoji} {g.name}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatINR(g.spentPaise)} / {formatINR(g.limitPaise)}
                  </span>
                </div>
                <BudgetBar spent={g.spentPaise} budget={g.limitPaise} className="h-1" />
                {g.leaves.length > 0 && (
                  <ul className="space-y-0.5 pl-3 text-[11px] text-muted-foreground">
                    {g.leaves.map((l) => (
                      <li key={l.id} className="flex justify-between tabular-nums">
                        <span className="truncate">
                          {l.emoji} {l.name}
                        </span>
                        <span>{formatINR(l.paise)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">6-month trend</CardTitle>
        </CardHeader>
        <CardContent>
          <TrendChart points={data.trend} />
        </CardContent>
      </Card>

      {/* §2.12 — multi-month compare: category × month matrix */}
      {data.compareRows.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Compare months</CardTitle>
          </CardHeader>
          <CardContent>
            <CompareMatrix months={data.compareMonths} rows={data.compareRows} />
          </CardContent>
        </Card>
      )}

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
            recentCategoryIds={recentCategoryIds}
            enableSelection={false}
          />
        </CardContent>
      </Card>
    </div>
  );
}


