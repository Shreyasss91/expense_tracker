"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { renameCategory } from "@/db/category-mutations";
import { budgets, categories, members, transactions } from "@/db/schema";
import { budgetsForMonth, resolveEffectiveBudget } from "@/lib/budgets";
import { paiseToDbString, rupeesToPaise } from "@/lib/money";
import { saveBudgetsSchema, setTotalBudgetSchema, updateCategorySchema, updateMemberSchema } from "@/lib/validations";
import { z } from "zod";

/**
 * §6.5 — categories: rename, emoji, reorder ONLY.
 * The slug (§5.3) is immutable and never touched here; deletion is not offered in v1.
 */
export async function updateCategory(raw: z.infer<typeof updateCategorySchema>) {
  const parsed = updateCategorySchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid category data" };
  await renameCategory(db, parsed.data);
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/settings");
  revalidateTag("transactions");
  revalidateTag("categories");
  return { ok: true as const };
}

export async function reorderCategories(ids: string[]) {
  const parsed = z.array(z.string().uuid()).safeParse(ids);
  if (!parsed.success) return { ok: false as const, error: "Invalid order" };
  await db.transaction(async (tx) => {
    for (let i = 0; i < parsed.data.length; i++) {
      await tx.update(categories).set({ sortOrder: i + 1 }).where(eq(categories.id, parsed.data[i]));
    }
  });
  revalidatePath("/transactions");
  revalidatePath("/settings");
  revalidateTag("categories");
  return { ok: true as const };
}

/**
 * §6.5 — members: name, emoji, colour and order editable.
 * The slug (§3.2.2) is immutable and never touched here; deletion is not offered in v1.
 */
export async function updateMember(raw: z.infer<typeof updateMemberSchema>) {
  const parsed = updateMemberSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid member data" };
  await db
    .update(members)
    .set({ name: parsed.data.name, emoji: parsed.data.emoji, color: parsed.data.color, sortOrder: parsed.data.sortOrder })
    .where(eq(members.id, parsed.data.id));
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/settings");
  revalidateTag("transactions");
  revalidateTag("members");
  return { ok: true as const };
}

export async function reorderMembers(ids: string[]) {
  const parsed = z.array(z.string().uuid()).safeParse(ids);
  if (!parsed.success) return { ok: false as const, error: "Invalid order" };
  await db.transaction(async (tx) => {
    for (let i = 0; i < parsed.data.length; i++) {
      await tx.update(members).set({ sortOrder: i + 1 }).where(eq(members.id, parsed.data[i]));
    }
  });
  revalidatePath("/");
  revalidatePath("/settings");
  revalidateTag("members");
  return { ok: true as const };
}

/**
 * §6.7 saveBudgets — replaces the entire budget scope for a month in one
 * transaction: delete-then-insert, so the (month, category) uniqueness is
 * guaranteed by construction. A paise of 0 means "no limit" and is not
 * stored. Category ids are validated as UUIDs; a scope with no stored rows
 * simply means no budget is set for that month.
 */
export async function saveBudgets(raw: z.infer<typeof saveBudgetsSchema>) {
  const parsed = saveBudgetsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid budget data" };
  const { month, totalPaise, categories: categoryLimits } = parsed.data;

  await db.transaction(async (tx) => {
    await tx.delete(budgets).where(month === null ? sql`${budgets.month} IS NULL` : eq(budgets.month, month));

    const rows: (typeof budgets.$inferInsert)[] = [];
    if (totalPaise && totalPaise > 0) {
      rows.push({ month, categoryId: null, amount: paiseToDbString(totalPaise) });
    }
    for (const c of categoryLimits) {
      if (c.paise > 0) rows.push({ month, categoryId: c.categoryId, amount: paiseToDbString(c.paise) });
    }
    if (rows.length > 0) await tx.insert(budgets).values(rows);
  });

  revalidatePath("/");
  revalidatePath("/settings");
  revalidateTag("transactions"); // dashboard aggregates are cached under this tag
  return { ok: true as const };
}

/**
 * §6.7 — inline total-budget edit/clear from the dashboard Budget card.
 * Touches only the total row (categoryId NULL) for the given month — category
 * budgets are left untouched. paise 0 or null clears the total budget.
 */
export async function setTotalBudget(raw: z.infer<typeof setTotalBudgetSchema>) {
  const parsed = setTotalBudgetSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid budget data" };
  const { month, totalPaise } = parsed.data;

  await db.transaction(async (tx) => {
    await tx.delete(budgets).where(and(eq(budgets.month, month), isNull(budgets.categoryId)));
    if (totalPaise && totalPaise > 0) {
      await tx.insert(budgets).values({ month, categoryId: null, amount: paiseToDbString(totalPaise) });
    }
  });

  revalidatePath("/");
  revalidatePath("/settings");
  revalidateTag("transactions");
  return { ok: true as const };
}

/**
 * §6.7 — remaining budget per category for a month, for the Quick Add grid.
 * Effective budget (exact month wins, else the default) minus the category's
 * spend so far in that month. Only categories with a budget are returned;
 * remaining can be negative (over budget).
 */
export async function getCategoryBudgetStatus(monthKey: string) {
  const month = z.string().regex(/^\d{4}-\d{2}$/).safeParse(monthKey);
  if (!month.success) return { ok: false as const, error: "Invalid month" };
  const key = month.data;

  const [budgetRows, spentRows] = await Promise.all([
    budgetsForMonth(key),
    db
      .select({
        categoryId: transactions.categoryId,
        total: sql<string>`SUM(${transactions.amount})`,
      })
      .from(transactions)
      .where(and(eq(transactions.type, "expense"), gte(transactions.date, `${key}-01`), lte(transactions.date, monthEnd(key))))
      .groupBy(transactions.categoryId),
  ]);

  const spent = new Map(spentRows.map((r) => [r.categoryId, rupeesToPaise(r.total)]));
  const categories = budgetRows
    .filter((b) => b.categoryId !== null)
    .map((b) => b.categoryId!)
    .filter((id, i, self) => self.indexOf(id) === i)
    .map((categoryId) => {
      const budget = resolveEffectiveBudget(budgetRows, key, categoryId);
      const limitPaise = budget ? rupeesToPaise(budget.amount) : 0;
      return { categoryId, remainingPaise: limitPaise - (spent.get(categoryId) ?? 0) };
    });

  return { ok: true as const, categories };
}

function monthEnd(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${monthKey}-${String(lastDay).padStart(2, "0")}`;
}
