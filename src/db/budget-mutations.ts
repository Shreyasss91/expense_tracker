import { and, eq, isNull, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { budgets } from "./schema";
import { paiseToDbString } from "../lib/money";

/**
 * §2.1 — a single budget line item. Exactly one of `categoryId` / `groupId`
 * is set (or both null for the month TOTAL). `paise` 0 means "no limit" and
 * is dropped by the caller before it reaches `replaceBudgetScope`.
 */
export interface BudgetLimitInput {
  categoryId?: string | null;
  groupId?: string | null;
  paise: number;
}

/** Stable scope key for the desired-set map (§2.1: total / category / group). */
function scopeKeyOf(input: { categoryId?: string | null; groupId?: string | null }): string {
  if (input.categoryId) return `c:${input.categoryId}`;
  if (input.groupId) return `g:${input.groupId}`;
  return "__total__";
}

/**
 * §6.7 / §2.1 — replace an entire budget scope (one month, or the every-month
 * default when `month` is null). Supports total, per-category AND per-group
 * limits (§2.1) in one pass.
 *
 * The application's driver is drizzle's neon-http client, which does not
 * support SQL transactions, so the original implementation did
 * DELETE-then-INSERT. That left the whole scope EMPTY if the insert failed —
 * catastrophic for the every-month default, which deletes every default
 * budget at once (§1.10).
 *
 * The failure-safe approach used here: update existing rows in place, insert
 * only the genuinely new ones, then delete rows no longer in the desired set.
 * Any failure mid-flight leaves the previous data intact instead of wiping
 * the scope, and the `budgets_scope_unique` index can never be violated
 * because unchanged rows are UPDATEd, not re-INSERTed.
 */
export async function replaceBudgetScope<TSchema extends Record<string, unknown>>(
  db: NeonHttpDatabase<TSchema>,
  month: string | null,
  totalPaise: number,
  categoryLimits: BudgetLimitInput[],
  groupLimits: BudgetLimitInput[] = [],
): Promise<void> {
  // Build the desired set: a stable key per scope row → its target columns.
  const desired = new Map<string, BudgetLimitInput>();
  if (totalPaise > 0) desired.set("__total__", { categoryId: null, groupId: null, paise: totalPaise });
  for (const c of categoryLimits) {
    if (c.paise > 0) desired.set(scopeKeyOf(c), { categoryId: c.categoryId, groupId: null, paise: c.paise });
  }
  for (const g of groupLimits) {
    if (g.paise > 0) desired.set(scopeKeyOf(g), { categoryId: null, groupId: g.groupId, paise: g.paise });
  }

  const scopeWhere = month === null ? sql`${budgets.month} IS NULL` : eq(budgets.month, month);
  const existingRows = await db
    .select({ id: budgets.id, categoryId: budgets.categoryId, groupId: budgets.groupId, amount: budgets.amount })
    .from(budgets)
    .where(scopeWhere);

  for (const [key, input] of desired) {
    const existing = existingRows.find(
      (r) => (r.categoryId ?? null) === (input.categoryId ?? null) && (r.groupId ?? null) === (input.groupId ?? null),
    );
    const amountStr = paiseToDbString(input.paise);
    if (existing) {
      if (existing.amount !== amountStr) {
        await db
          .update(budgets)
          .set({ amount: amountStr, updatedAt: new Date() })
          .where(eq(budgets.id, existing.id));
      }
    } else {
      await db.insert(budgets).values({ month, categoryId: input.categoryId ?? null, groupId: input.groupId ?? null, amount: amountStr });
    }
  }

  // Delete rows that exist in the scope but are no longer in the desired set.
  for (const r of existingRows) {
    const key =
      (r.categoryId ?? null) === null && (r.groupId ?? null) === null
        ? "__total__"
        : (r.groupId ?? null) !== null
          ? `g:${r.groupId}`
          : `c:${r.categoryId}`;
    if (!desired.has(key)) {
      await db.delete(budgets).where(eq(budgets.id, r.id));
    }
  }
}

/**
 * §6.7 — replace only the total row (categoryId NULL) for one month — the
 * inline edit/clear on the dashboard Budget card. Same failure-safe
 * update-or-insert-then-delete approach as `replaceBudgetScope`.
 * `totalPaise` null/0 clears the total budget.
 */
export async function replaceTotalBudgetRow<TSchema extends Record<string, unknown>>(
  db: NeonHttpDatabase<TSchema>,
  month: string,
  totalPaise: number | null,
): Promise<void> {
  const [existing] = await db
    .select({ id: budgets.id, amount: budgets.amount })
    .from(budgets)
    .where(and(eq(budgets.month, month), isNull(budgets.categoryId)));

  if (totalPaise && totalPaise > 0) {
    const amountStr = paiseToDbString(totalPaise);
    if (existing) {
      if (existing.amount !== amountStr) {
        await db.update(budgets).set({ amount: amountStr, updatedAt: new Date() }).where(eq(budgets.id, existing.id));
      }
    } else {
      await db.insert(budgets).values({ month, categoryId: null, amount: amountStr });
    }
  } else if (existing) {
    // Clearing the total: only delete now that we know there is nothing to
    // replace it with (never delete before the replacement is in place).
    await db.delete(budgets).where(eq(budgets.id, existing.id));
  }
}
