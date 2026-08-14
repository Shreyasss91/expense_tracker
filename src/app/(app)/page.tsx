import { addMonths, format, parse } from "date-fns";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, members, transactions } from "@/db/schema";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { monthEndInIST, monthKeyInIST } from "@/lib/dates";
import { MonthPicker } from "@/components/dashboard/month-picker";
import { CategoryPie, MemberSplit, TagBar, TrendChart } from "@/components/dashboard/charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const MONTH_RE = /^\d{4}-\d{2}$/;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const monthKey = typeof sp.month === "string" && MONTH_RE.test(sp.month) ? sp.month : monthKeyInIST();
  const start = `${monthKey}-01`;
  const end = monthEndInIST(parse(`${monthKey}-01`, "yyyy-MM-dd", new Date()));
  const range = and(gte(transactions.date, start), lte(transactions.date, end));

  // §7.2 — all analytics are SQL aggregates; never client-side reduction.
  const [totals, tagRows, catRows, memberRows, trendRows, memberList] = await Promise.all([
    db
      .select({ type: transactions.type, total: sql<string>`SUM(${transactions.amount})` })
      .from(transactions)
      .where(range)
      .groupBy(transactions.type),
    db
      .select({ tag: transactions.tag, total: sql<string>`SUM(${transactions.amount})` })
      .from(transactions)
      .where(and(eq(transactions.type, "expense"), gte(transactions.date, start), lte(transactions.date, end)))
      .groupBy(transactions.tag),
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
      .where(gte(transactions.date, `${format(addMonths(parse(`${monthKey}-01`, "yyyy-MM-dd", new Date()), -5), "yyyy-MM")}-01`))
      .groupBy(sql`substring(${transactions.date}::text from 1 for 7)`),
    db.select().from(members).orderBy(asc(members.sortOrder)),
  ]);

  const incomePaise = rupeesToPaise(totals.find((t) => t.type === "income")?.total ?? "0");
  const expensePaise = rupeesToPaise(totals.find((t) => t.type === "expense")?.total ?? "0");
  const netPaise = incomePaise - expensePaise;

  const tagMap = new Map(tagRows.map((r) => [r.tag, rupeesToPaise(r.total)]));
  const tags = [
    { key: "recurring", label: "Bills", paise: tagMap.get("recurring") ?? 0, color: "#8b5cf6" },
    { key: "lifestyle", label: "Lifestyle", paise: tagMap.get("lifestyle") ?? 0, color: "#0ea5e9" },
    { key: "one_time", label: "One-time buys", paise: tagMap.get("one_time") ?? 0, color: "#f59e0b" },
  ] as const;

  const memberPaise = new Map(memberRows.map((r) => [r.id, rupeesToPaise(r.total)]));
  const memberSlices = memberList.map((m) => ({
    name: m.name,
    emoji: m.emoji,
    color: m.color,
    paise: memberPaise.get(m.id) ?? 0,
  }));

  // §6.3.1: months with no data plot as 0, not a gap — the axis stays continuous.
  const base = parse(`${monthKey}-01`, "yyyy-MM-dd", new Date());
  const trendKeys = Array.from({ length: 6 }, (_, i) => format(addMonths(base, i - 5), "yyyy-MM"));
  const trendMap = new Map(trendRows.map((r) => [r.month, r]));
  const trend = trendKeys.map((k) => {
    const r = trendMap.get(k);
    return {
      label: format(parse(`${k}-01`, "yyyy-MM-dd", new Date()), "MMM"),
      expensePaise: r ? rupeesToPaise(r.expense) : 0,
      incomePaise: r ? rupeesToPaise(r.income) : 0,
    };
  });

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
            <p className="mt-1 truncate text-base font-semibold tabular-nums text-emerald-600 sm:text-lg">{formatINR(incomePaise)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Expense</p>
            <p className="mt-1 truncate text-base font-semibold tabular-nums text-red-600 sm:text-lg">{formatINR(expensePaise)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Net savings</p>
            {/* §6.3.1: with zero income, show the negative expense total in red — never a % */}
            <p className={`mt-1 truncate text-base font-semibold tabular-nums sm:text-lg ${netPaise < 0 ? "text-red-600" : "text-emerald-600"}`}>{formatINR(netPaise)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tag breakdown (§6.3) — denominator is total EXPENSE, never income */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Tag breakdown</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {tags.map((t) => (
            <TagBar key={t.key} label={t.label} paise={t.paise} totalExpense={expensePaise} color={t.color} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Spending by category</CardTitle>
        </CardHeader>
        <CardContent>
          <CategoryPie
            slices={catRows.map((r) => ({
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
          <MemberSplit slices={memberSlices} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">6-month trend</CardTitle>
        </CardHeader>
        <CardContent>
          <TrendChart points={trend} />
        </CardContent>
      </Card>
    </div>
  );
}
