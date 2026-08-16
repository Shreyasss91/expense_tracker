import { and, eq, isNull, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { budgets } from "./schema";
import { paiseToDbString } from "../lib/money";

export interface BudgetLimitInput {
  categoryId: string;
  paise: number;
}

/**
 * §6.7 — replace an entire budget scope (one month, or the every-month
 * default when `month` is null) by delete-then-insert.
 *
 * Plain sequential statements, NOT a `db.transaction`: the app's driver is
 * drizzle's neon-http client, which does not support transactions and throws
 * on `db.transaction(...)`. Deleting the whole scope first means the
 * `budgets_scope_unique` index can never be violated by the insert, and the
 * scope is left empty (no budget) rather than half-written if a statement
 * fails. `paise` 0 means "no limit" and is not stored.
 */
export async function replaceBudgetScope<TSchema extends Record<string, unknown>>(
  db: NeonHttpDatabase<TSchema>,
  month: string | null,
  totalPaise: number,
  categoryLimits: BudgetLimitInput[],
): Promise<void> {
  await db.delete(budgets).where(month === null ? sql`${budgets.month} IS NULL` : eq(budgets.month, month));

  const rows: (typeof budgets.$inferInsert)[] = [];
  if (totalPaise > 0) rows.push({ month, categoryId: null, amount: paiseToDbString(totalPaise) });
  for (const c of categoryLimits) {
    if (c.paise > 0) rows.push({ month, categoryId: c.categoryId, amount: paiseToDbString(c.paise) });
  }
  if (rows.length > 0) await db.insert(budgets).values(rows);
}

/**
 * §6.7 — replace only the total row (categoryId NULL) for one month — the
 * inline edit/clear on the dashboard Budget card. Same plain-statement
 * approach as `replaceBudgetScope`; category budgets are left untouched.
 * `totalPaise` null/0 clears the total budget.
 */
export async function replaceTotalBudgetRow<TSchema extends Record<string, unknown>>(
  db: NeonHttpDatabase<TSchema>,
  month: string,
  totalPaise: number | null,
): Promise<void> {
  await db.delete(budgets).where(and(eq(budgets.month, month), isNull(budgets.categoryId)));
  if (totalPaise && totalPaise > 0) {
    await db.insert(budgets).values({ month, categoryId: null, amount: paiseToDbString(totalPaise) });
  }
}
