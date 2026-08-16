import { addMonths, format, parse } from "date-fns";
import { getTransactionsPage } from "@/actions/transactions";
import { getCategories, getMembers } from "@/lib/meta";
import { FiltersBar, type LedgerFilters } from "@/components/transactions/filters";
import { TransactionsList } from "@/components/transactions/transactions-list";
import { ExportButton } from "@/components/transactions/export-button";
import { MonthStrip } from "@/components/transactions/month-strip";
import { LedgerSummaryHeader } from "@/components/transactions/ledger-summary";
import { TRANSACTION_TAGS } from "@/lib/constants";
import { monthKeyInIST } from "@/lib/dates";
import type { CategoryOption, MemberOption } from "@/components/quick-add/types";
import { getLedgerSummary, type TransactionListFilters } from "@/lib/query";
import { z } from "zod";

export const metadata = { title: "Ledger — Family Ledger" };

const uuid = z.string().uuid();
const monthRe = /^\d{4}-\d{2}$/;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const read = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

  const rawTag = read(sp.tag);
  const filters: TransactionListFilters = {
    memberId: (() => {
      const v = read(sp.member);
      return v && uuid.safeParse(v).success ? v : undefined;
    })(),
    categoryId: (() => {
      const v = read(sp.category);
      return v && uuid.safeParse(v).success ? v : undefined;
    })(),
    tag: rawTag && (TRANSACTION_TAGS as readonly string[]).includes(rawTag) ? (rawTag as TransactionListFilters["tag"]) : undefined,
    type: (() => {
      const v = read(sp.type);
      return v === "income" || v === "expense" ? v : undefined;
    })(),
    month: (() => {
      const v = read(sp.month);
      return v && monthRe.test(v) ? v : undefined;
    })(),
    search: read(sp.q)?.slice(0, 100),
  };
  const ledgerFilters: LedgerFilters = { ...filters, q: filters.search };

  // §5.7: the strip window is derived from the current IST month and covers the
  // whole seeded history (36 months); "All" reaches anything older.
  const stripBase = parse(`${monthKeyInIST()}-01`, "yyyy-MM-dd", new Date());
  const stripMonths = Array.from({ length: 36 }, (_, i) => format(addMonths(stripBase, i - 35), "yyyy-MM"));

  const [firstPage, summary, memberRows, categoryRows] = await Promise.all([
    getTransactionsPage({ cursor: null, filters }),
    getLedgerSummary(filters),
    getMembers(),
    getCategories(),
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Ledger</h1>
        <ExportButton />
      </div>
      <MonthStrip months={stripMonths} selected={filters.month} filters={ledgerFilters} />
      <LedgerSummaryHeader monthKey={filters.month} summary={summary} />
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
