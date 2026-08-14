import Link from "next/link";
import { unstable_cache } from "next/cache";
import { addMonths, format, parse } from "date-fns";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, members, transactions } from "@/db/schema";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { monthEndInIST, monthKeyInIST } from "@/lib/dates";
import { getCategories, getMembers } from "@/lib/meta";
import { getTransactionsPage } from "@/actions/transactions";
import { MonthPicker } from "@/components/dashboard/month-picker";
import { CategoryPie, MemberSplit, TagBar, TrendChart } from "@/components/dashboard/charts";
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

    const [totalsTags, catRows, memberRows, trendRows, memberList] = await Promise.all([
      // income + expense + all three expense tags in a single pass over the month
      db
        .select({
          income: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.type} = 'income'), 0)`,
          expense: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.type} = 'expense'), 0)`,
          recurring: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.type} = 'expense' AND ${transactions.tag} = 'recurring'), 0)`,
          lifestyle: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.type} = 'expense' AND ${transactions.tag} = 'lifestyle'), 0)`,
          oneTime: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.type} = 'expense' AND ${transactions.tag} = 'one_time'), 0)`,
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
        .innerJoin(categories, eq(transactions.categoryId, categories.id))
        .where(and(eq(transactions.type, "expense"), gte(transactions.date, start), lte(transactions.date, end)))
        .groupBy(categories.id, categories.name, categories.emoji, categories.color),
      db
        .select({
          id: members.id,
          name: members.name,
          emoji: members.emoji,
          color: members.color,
          total: sql<string>`SUM(${transactions.amount})`,
        })
        .from(transactions)
        .innerJoin(members, eq(transactions.memberId, members.id))
        .where(and(eq(transactions.type, "expense"), gte(transactions.date, start), lte(transactions.date, end)))
        .groupBy(members.id, members.name, members.emoji, members.color),
      db
        .select({
          month: sql<string>`substring(${transactions.date}::text from 1 for 7)`,
          expense: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'expense' THEN ${transactions.amount} ELSE 0 END), 0)`,
          income: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'income' THEN ${transactions.amount} ELSE 0 END), 0)`,
        })
        .from(transactions)
        .where(gte(transactions.date, `${format(addMonths(baseDate, -5), "yyyy-MM")}-01`))
        .groupBy(sql`substring(${transactions.date}::text from 1 for 7)`),
      db.select().from(members).orderBy(asc(members.sortOrder)),
    ]);

    const totals = totalsTags[0];
    const incomePaise = rupeesToPaise(totals.income);
    const expensePaise = rupeesToPaise(totals.expense);
    const netPaise = incomePaise - expensePaise;

    const tags = [
      { key: "recurring", label: "Bills", paise: rupeesToPaise(totals.recurring), color: "#8b5cf6" },
      { key: "lifestyle", label: "Lifestyle", paise: rupeesToPaise(totals.lifestyle), color: "#0ea5e9" },
      { key: "one_time", label: "One-time buys", paise: rupeesToPaise(totals.oneTime), color: "#f59e0b" },
    ] as const;

    const memberPaise = new Map(memberRows.map((r) => [r.id, rupeesToPaise(r.total)]));
    const memberSlices = memberList.map((m) => ({
      name: m.name,
      emoji: m.emoji,
      color: m.color,
      paise: memberPaise.get(m.id) ?? 0,
    }));

    // §6.3.1: months with no data plot as 0, not a gap — the axis stays continuous.
    const trendKeys = Array.from({ length: 6 }, (_, i) => format(addMonths(baseDate, i - 5), "yyyy-MM"));
    const trendMap = new Map(trendRows.map((r) => [r.month, r]));
    const trend = trendKeys.map((k) => {
      const r = trendMap.get(k);
      return {
        label: format(parse(`${k}-01`, "yyyy-MM-dd", new Date()), "MMM"),
        expensePaise: r ? rupeesToPaise(r.expense) : 0,
        incomePaise: r ? rupeesToPaise(r.income) : 0,
      };
    });

    return { incomePaise, expensePaise, netPaise, tags, catRows, memberSlices, trend };
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
  const [data, firstPage, memberRows, categoryRows] = await Promise.all([
    getDashboardData(monthKey),
    getTransactionsPage({ cursor: null, filters: { month: monthKey } }),
    getMembers(),
    getCategories(),
  ]);
  const memberOptions = memberRows.map((m) => ({
    id: m.id, slug: m.slug, name: m.name, emoji: m.emoji, color: m.color, sortOrder: m.sortOrder,
  }));
  const categoryOptions = categoryRows.map((c) => ({
    id: c.id, slug: c.slug, name: c.name, emoji: c.emoji, color: c.color, sortOrder: c.sortOrder,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Overview</h1>
        <MonthPicker month={monthKey} />
      </div>

      {/* Summary cards (§6.3) */}
      <div className="grid grid-cols-3 gap-2">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Income</p>
            <p className="mt-1 truncate text-base font-semibold tabular-nums text-emerald-600 sm:text-lg">{formatINR(data.incomePaise)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Expense</p>
            <p className="mt-1 truncate text-base font-semibold tabular-nums text-red-600 sm:text-lg">{formatINR(data.expensePaise)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Net savings</p>
            {/* §6.3.1: with zero income, show the negative expense total in red — never a % */}
            <p className={`mt-1 truncate text-base font-semibold tabular-nums sm:text-lg ${data.netPaise < 0 ? "text-red-600" : "text-emerald-600"}`}>{formatINR(data.netPaise)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tag breakdown (§6.3) — denominator is total EXPENSE, never income */}
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
        <CardContent>
          <CategoryPie
            slices={data.catRows.map((r) => ({
              name: r.name,
              emoji: r.emoji,
              color: r.color,
              paise: rupeesToPaise(r.total),
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Who spent</CardTitle>
        </CardHeader>
        <CardContent>
          <MemberSplit slices={data.memberSlices} />
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
