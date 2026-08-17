// No `server-only` guard here by design: every helper takes the db connection
// as its first argument (same convention as src/db/*-mutations.ts), so the
// DB-backed regression tests can drive the exact production queries against
// their own connection. The app imports this module only from server code.

import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { getExcludeBillsEnabled } from "@/db/app-settings-mutations";
import { budgets, categories, transactions } from "@/db/schema";
import { rupeesToPaise } from "@/lib/money";
import { monthKeySchema } from "@/lib/validations";
import type { BudgetAlert } from "@/lib/budget-alert";

type BudgetDb = NeonHttpDatabase<Record<string, unknown>>;

export interface BudgetRow {
  month: string | null;
  categoryId: string | null;
  amount: string;
  categoryName: string | null;
  categoryEmoji: string | null;
  categoryColor: string | null;
}

export function resolveEffectiveBudget(
  rows: BudgetRow[],
  monthKey: string,
  categoryId: string | null,
): BudgetRow | undefined {
  const month = monthKeySchema.parse(monthKey);
  return (
    rows.find((b) => b.month === month && b.categoryId === categoryId) ??
    rows.find((b) => b.month === null && b.categoryId === categoryId)
  );
}

export function budgetsForMonth(db: BudgetDb, monthKey: string) {
  const month = monthKeySchema.parse(monthKey);
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
    .where(or(eq(budgets.month, month), isNull(budgets.month)));
}

function monthBounds(monthKey: string): { start: string; end: string } {
  const month = monthKeySchema.parse(monthKey);
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

export async function getMonthBudgetStatus(
  db: BudgetDb,
  monthKey: string,
): Promise<{ spentPaise: number; budgetPaise: number; billsPaise: number; excludeBills: boolean } | null> {
  const { start, end } = monthBounds(monthKey);
  const validatedMonth = monthKeySchema.parse(monthKey);

  const [budgetRows, excludeBills, rows] = await Promise.all([
    budgetsForMonth(db, validatedMonth),
    getExcludeBillsEnabled(db),
    db
      .select({
        expense: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.type} = 'expense'), 0)`,
        recurring: sql<string>`COALESCE(SUM(${transactions.amount}) FILTER (WHERE ${transactions.type} = 'expense' AND ${transactions.tag} = 'recurring'), 0)`,
      })
      .from(transactions)
      .where(and(gte(transactions.date, start), lte(transactions.date, end))),
  ]);

  const totalBudget = resolveEffectiveBudget(budgetRows, validatedMonth, null);
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

export async function getBudgetAlert(db: BudgetDb, monthKey: string, categoryId: string): Promise<BudgetAlert | null> {
  const validatedMonth = monthKeySchema.parse(monthKey);
  const { start, end } = monthBounds(validatedMonth);

  const [budgetRows, excludeBills, totals] = await Promise.all([
    budgetsForMonth(db, validatedMonth),
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

  const totalBudget = resolveEffectiveBudget(budgetRows, validatedMonth, null);
  const totalPaise = rupeesToPaise(totals[0].total) - (excludeBills ? rupeesToPaise(totals[0].recurring) : 0);
  if (totalBudget && totalPaise > rupeesToPaise(totalBudget.amount)) {
    return {
      kind: "total" as const,
      label: "This month",
      overPaise: totalPaise - rupeesToPaise(totalBudget.amount),
      limitPaise: rupeesToPaise(totalBudget.amount),
    };
  }

  const categoryBudget = resolveEffectiveBudget(budgetRows, validatedMonth, categoryId);
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
