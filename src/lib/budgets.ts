import "server-only";

import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { getExcludeBillsEnabled } from "@/db/app-settings-mutations";
import { budgets, categories, transactions } from "@/db/schema";
import { rupeesToPaise } from "@/lib/money";
import type { BudgetAlert } from "@/lib/budget-alert";

/** A budgets row as fetched for a month — the subset the app reasons with. */
export interface BudgetRow {
  month: string | null;
  categoryId: string | null;
  amount: string;
  categoryName: string | null;
  categoryEmoji: string | null;
  categoryColor: string | null;
}

/**
 * §6.7 — effective budget for a scope in a month: the exact-month row wins,
 * otherwise the every-month default applies. `categoryId === null` resolves
 * the total monthly budget.
 */
export function resolveEffectiveBudget(
  rows: BudgetRow[],
  monthKey: string,
  categoryId: string | null,
): BudgetRow | undefined {
  return (
    rows.find((b) => b.month === monthKey && b.categoryId === categoryId) ??
    rows.find((b) => b.month === null && b.categoryId === categoryId)
  );
}

/** The budgets relevant to one month: exact-month rows plus the defaults. */
export function budgetsForMonth(monthKey: string) {
  return db
    .select({
      month: budgets.month,
      categoryId: budgets.categoryId,
      amount: budgets.amount,
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
      categoryColor: categories.color,
    })
    .from(budgets)
    .leftJoin(categories, eq(budgets.categoryId, categories.id))
    .where(or(eq(budgets.month, monthKey), isNull(budgets.month)));
}

/**
 * §6.7 — spent-vs-budget for a month's total, for the ledger month strip: the
 * month's total expense against the effective total budget (exact month wins,
 * else the every-month default). When the global "exclude bills" setting is
 * on, the month's recurring spend is subtracted from the spent side (bills are
 * committed costs, not discretionary budget). Returns null when no total
 * budget is set for the month — the strip then shows no bar.
 */
export async function getMonthBudgetStatus(
  monthKey: string,
): Promise<{ spentPaise: number; budgetPaise: number; billsPaise: number; excludeBills: boolean } | null> {
  const start = `${monthKey}-01`;
  const [y, m] = monthKey.split("-").map(Number);
  const end = `${monthKey}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;

  const [budgetRows, excludeBills, rows] = await Promise.all([
    budgetsForMonth(monthKey),
    getExcludeBillsEnabled(db),
    db
      .select({
        expense: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.type} = 'expense'), 0)`,
        recurring: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.type} = 'expense' AND ${transactions.tag} = 'recurring'), 0)`,
      })
      .from(transactions)
      .where(and(gte(transactions.date, start), lte(transactions.date, end))),
  ]);

  const totalBudget = resolveEffectiveBudget(budgetRows, monthKey, null);
  if (!totalBudget) return null;

  const billsPaise = rupeesToPaise(rows[0].recurring);
  const expensePaise = rupeesToPaise(rows[0].expense);
  return {
    spentPaise: excludeBills ? expensePaise - billsPaise : expensePaise,
    budgetPaise: rupeesToPaise(totalBudget.amount),
    billsPaise,
    excludeBills,
  };
}

/**
 * §6.7 over-budget check, run by the create/update Server Actions after an
 * expense write. Compares the month total and the affected category's total
 * (both post-write, so the new row is included) against the effective budgets.
 * Returns the total alert if the month is over, else the category alert, else
 * null — one warning per write, the more important scope wins.
 */
export async function getBudgetAlert(monthKey: string, categoryId: string): Promise<BudgetAlert | null> {
  const start = `${monthKey}-01`;
  const [y, m] = monthKey.split("-").map(Number);
  const end = `${monthKey}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;

  const [budgetRows, excludeBills, totals] = await Promise.all([
    budgetsForMonth(monthKey),
    getExcludeBillsEnabled(db),
    db
      .select({
        total: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.type} = 'expense'), 0)`,
        recurring: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.type} = 'expense' AND ${transactions.tag} = 'recurring'), 0)`,
        category: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.type} = 'expense' AND ${transactions.categoryId} = ${categoryId}), 0)`,
      })
      .from(transactions)
      .where(and(gte(transactions.date, start), lte(transactions.date, end))),
  ]);

  const totalBudget = resolveEffectiveBudget(budgetRows, monthKey, null);
  // §6.7 — when exclude-bills is on, the total comparison ignores recurring spend;
  // the category comparison below always counts everything (owner decision).
  const totalPaise = rupeesToPaise(totals[0].total) - (excludeBills ? rupeesToPaise(totals[0].recurring) : 0);
  if (totalBudget && totalPaise > rupeesToPaise(totalBudget.amount)) {
    return {
      kind: "total" as const,
      label: "This month",
      overPaise: totalPaise - rupeesToPaise(totalBudget.amount),
      limitPaise: rupeesToPaise(totalBudget.amount),
    };
  }

  const categoryBudget = resolveEffectiveBudget(budgetRows, monthKey, categoryId);
  const categoryPaise = rupeesToPaise(totals[0].category);
  if (categoryBudget && categoryPaise > rupeesToPaise(categoryBudget.amount)) {
    const row = budgetRows.find((b) => b.categoryId === categoryId);
    return {
      kind: "category" as const,
      label: row?.categoryName ?? "Category",
      emoji: row?.categoryEmoji ?? undefined,
      overPaise: categoryPaise - rupeesToPaise(categoryBudget.amount),
      limitPaise: rupeesToPaise(categoryBudget.amount),
    };
  }

  return null;
}
