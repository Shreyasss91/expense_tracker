"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { setAppSetting, EXCLUDE_BILLS_KEY } from "@/db/app-settings-mutations";
import { renameCategory, isAssignableCategory } from "@/db/category-mutations";
import { replaceBudgetScope, replaceTotalBudgetRow } from "@/db/budget-mutations";
import { categories, members, transactions } from "@/db/schema";
import { budgetsForMonth, resolveEffectiveBudget } from "@/lib/budgets";
import { rupeesToPaise } from "@/lib/money";
import { createCategoryGroupSchema, createCategorySchema, monthKeySchema, moveCategoryToGroupSchema, saveBudgetsSchema, setExcludeBillsSchema, setTotalBudgetSchema, updateCategorySchema, updateMemberSchema } from "@/lib/validations";
import { z } from "zod";

function validateCompleteUniqueIds(ids: string[], expectedIds: string[]): string[] | null {
  const parsed = z.array(z.string().uuid()).safeParse(ids);
  if (!parsed.success) return null;
  const unique = new Set(parsed.data);
  const expected = new Set(expectedIds);
  if (unique.size !== parsed.data.length || unique.size !== expected.size) return null;
  if (parsed.data.some((id) => !expected.has(id))) return null;
  return parsed.data;
}

// §6.2 — palette for user-created categories (deterministic pick from the slug).
const CATEGORY_COLORS = [
  "#0ea5e9", "#f97316", "#8b5cf6", "#22c55e", "#ef4444",
  "#eab308", "#14b8a6", "#6366f1", "#ec4899", "#10b981",
] as const;

function slugifyCategoryName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
  return slug || "category";
}

function categoryColor(slug: string): string {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return CATEGORY_COLORS[h % CATEGORY_COLORS.length];
}

/**
 * §6.2/§6.5 — create a category inline from Quick Add / the edit dialog.
 * The slug (§5.3) is generated from the name and is immutable; the color is
 * picked deterministically. Two-level hierarchy: inline-created categories
 * are always LEAVES — they land in `parentId` when given (must name a real
 * top-level group), otherwise the household's "Other" group, so they are
 * immediately assignable and roll up into the dashboard.
 */
export async function createCategory(raw: z.infer<typeof createCategorySchema>) {
  const parsed = createCategorySchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid category data" };
  const { name, emoji, parentId } = parsed.data;

  // Resolve the destination group: explicit id must be a top-level row,
  // otherwise fall back to grp-other (the catch-all).
  let groupRow;
  if (parentId) {
    groupRow = await db.query.categories.findFirst({ where: eq(categories.id, parentId) });
    if (!groupRow || groupRow.parentId !== null) {
      return { ok: false as const, error: "Categories can only be created inside a top-level group" };
    }
  } else {
    groupRow = await db.query.categories.findFirst({ where: eq(categories.slug, OTHER_GROUP_SLUG) });
    if (!groupRow) return { ok: false as const, error: "Default group not found" };
  }

  const existing = await db.select({ slug: categories.slug }).from(categories);
  const taken = new Set(existing.map((r) => r.slug));
  const base = slugifyCategoryName(name);
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;

  // sortOrder is scoped to the destination group's children.
  const [maxRow] = await db
    .select({ max: sql<number>`COALESCE(MAX(${categories.sortOrder}), 0)` })
    .from(categories)
    .where(eq(categories.parentId, groupRow.id));

  const [row] = await db
    .insert(categories)
    .values({
      slug,
      name,
      emoji: emoji || "🏷️",
      color: categoryColor(slug),
      sortOrder: (maxRow?.max ?? 0) + 1,
      parentId: groupRow.id,
    })
    .returning();

  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/settings");
  revalidateTag("transactions");
  revalidateTag("categories");
  return { ok: true as const, category: row };
}

/** Slug prefix reserved for group rows so they can never collide with leaf slugs. */
const GROUP_SLUG_PREFIX = "grp-";
/** The catch-all group — inline-created categories without an explicit group land here. */
export const OTHER_GROUP_SLUG = "grp-other";

/**
 * Create a new top-level group (Settings). Groups are containers only — they
 * hold leaves and roll up their spend; they are never directly assignable.
 */
export async function createCategoryGroup(raw: z.infer<typeof createCategoryGroupSchema>) {
  const parsed = createCategoryGroupSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid group data" };
  const { name, emoji } = parsed.data;

  const existing = await db.select({ slug: categories.slug }).from(categories);
  const taken = new Set(existing.map((r) => r.slug));
  const base = `${GROUP_SLUG_PREFIX}${slugifyCategoryName(name)}`;
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;

  const [maxRow] = await db
    .select({ max: sql<number>`COALESCE(MAX(${categories.sortOrder}), 0)` })
    .from(categories)
    .where(isNull(categories.parentId));

  const [row] = await db
    .insert(categories)
    .values({
      slug,
      name,
      emoji: emoji || "🧺",
      color: categoryColor(slug),
      sortOrder: (maxRow?.max ?? 0) + 1,
      parentId: null,
    })
    .returning();

  revalidatePath("/");
  revalidatePath("/settings");
  revalidateTag("categories");
  return { ok: true as const, category: row };
}

/**
 * Move a leaf category to another group. The target must be a top-level row
 * (and not the category itself); only rows that already have a parent can be
 * moved — nesting a group inside anything would break the depth cap of 2.
 */
export async function moveCategoryToGroup(raw: z.infer<typeof moveCategoryToGroupSchema>) {
  const parsed = moveCategoryToGroupSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid move data" };
  const { categoryId, groupId } = parsed.data;
  if (categoryId === groupId) return { ok: false as const, error: "Cannot move a category under itself" };

  const [category] = await db.select().from(categories).where(eq(categories.id, categoryId));
  if (!category) return { ok: false as const, error: "Category not found" };
  if (category.parentId === null) return { ok: false as const, error: "Groups cannot be moved — edit the group instead" };

  const target = await db.query.categories.findFirst({ where: eq(categories.id, groupId) });
  if (!target || target.parentId !== null) return { ok: false as const, error: "Target is not a top-level group" };

  await db.update(categories).set({ parentId: groupId }).where(eq(categories.id, categoryId));

  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/settings");
  revalidateTag("categories");
  return { ok: true as const };
}

/**
 * §6.5 — categories: rename, emoji, reorder ONLY (creation happens inline from
 * Quick Add via createCategory above).
 * The slug (§5.3) is immutable and never touched here; deletion is not offered in v1.
 */
export async function updateCategory(raw: z.infer<typeof updateCategorySchema>) {
  const parsed = updateCategorySchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid category data" };
  const [row] = await db
    .update(categories)
    .set({ name: parsed.data.name, emoji: parsed.data.emoji, sortOrder: parsed.data.sortOrder })
    .where(eq(categories.id, parsed.data.id))
    .returning({ id: categories.id });
  if (!row) return { ok: false as const, error: "Category not found" };
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/settings");
  revalidateTag("transactions");
  revalidateTag("categories");
  return { ok: true as const };
}

export async function reorderCategories(ids: string[]) {
  const existing = await db.select({ id: categories.id }).from(categories);
  const parsed = validateCompleteUniqueIds(ids, existing.map((row) => row.id));
  if (!parsed) return { ok: false as const, error: "Invalid category order" };
  // Plain sequential updates — the neon-http driver has no transaction support.
  for (let i = 0; i < parsed.length; i++) {
    await db.update(categories).set({ sortOrder: i + 1 }).where(eq(categories.id, parsed[i]));
  }
  revalidatePath("/transactions");
  revalidatePath("/settings");
  revalidateTag("categories");
  return { ok: true as const };
}

/**
 * Two-level hierarchy ordering — groups and their children are ordered
 * independently (a flat renumbering would scramble children across groups):
 *   - reorderCategoryGroups: the complete set of top-level rows, in order.
 *   - reorderCategoriesUnder: the complete set of one group's leaves, in order.
 */
export async function reorderCategoryGroups(ids: string[]) {
  const topLevel = await db.select({ id: categories.id }).from(categories).where(isNull(categories.parentId));
  const parsed = validateCompleteUniqueIds(ids, topLevel.map((row) => row.id));
  if (!parsed) return { ok: false as const, error: "Invalid group order" };
  for (let i = 0; i < parsed.length; i++) {
    await db.update(categories).set({ sortOrder: i + 1 }).where(eq(categories.id, parsed[i]));
  }
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/settings");
  revalidateTag("categories");
  return { ok: true as const };
}

export async function reorderCategoriesUnder(rawGroupId: string, ids: string[]) {
  const groupIdCheck = z.string().uuid().safeParse(rawGroupId);
  if (!groupIdCheck.success) return { ok: false as const, error: "Invalid group" };
  const group = await db.query.categories.findFirst({ where: eq(categories.id, groupIdCheck.data) });
  if (!group || group.parentId !== null) return { ok: false as const, error: "Not a top-level group" };
  const children = await db.select({ id: categories.id }).from(categories).where(eq(categories.parentId, group.id));
  const parsed = validateCompleteUniqueIds(ids, children.map((row) => row.id));
  if (!parsed) return { ok: false as const, error: "Invalid category order" };
  for (let i = 0; i < parsed.length; i++) {
    await db.update(categories).set({ sortOrder: i + 1 }).where(eq(categories.id, parsed[i]));
  }
  revalidatePath("/");
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
  const [row] = await db
    .update(members)
    .set({ name: parsed.data.name, emoji: parsed.data.emoji, color: parsed.data.color, sortOrder: parsed.data.sortOrder })
    .where(eq(members.id, parsed.data.id))
    .returning({ id: members.id });
  if (!row) return { ok: false as const, error: "Member not found" };
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/settings");
  revalidateTag("transactions");
  revalidateTag("members");
  return { ok: true as const };
}

export async function reorderMembers(ids: string[]) {
  const existing = await db.select({ id: members.id }).from(members);
  const parsed = validateCompleteUniqueIds(ids, existing.map((row) => row.id));
  if (!parsed) return { ok: false as const, error: "Invalid member order" };
  // Plain sequential updates — the neon-http driver has no transaction support.
  for (let i = 0; i < parsed.length; i++) {
    await db.update(members).set({ sortOrder: i + 1 }).where(eq(members.id, parsed[i]));
  }
  revalidatePath("/");
  revalidatePath("/settings");
  revalidateTag("members");
  return { ok: true as const };
}

/**
 * §6.7 saveBudgets — replaces the entire budget scope for a month:
 * delete-then-insert via `replaceBudgetScope` (plain statements, since the
 * neon-http driver has no transaction support), so the (month, category)
 * uniqueness is guaranteed by construction. A paise of 0 means "no limit"
 * and is not stored. Category ids are validated as UUIDs; a scope with no
 * stored rows simply means no budget is set for that month.
 */
export async function saveBudgets(raw: z.infer<typeof saveBudgetsSchema>) {
  const parsed = saveBudgetsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid budget data" };
  const { month, totalPaise, categories: categoryLimits } = parsed.data;

  const categoryIds = categoryLimits.map((item) => item.categoryId);
  const uniqueCategoryIds = new Set(categoryIds);
  if (uniqueCategoryIds.size !== categoryIds.length) {
    return { ok: false as const, error: "Duplicate category budget" };
  }
  if (categoryIds.length > 0) {
    // Budgets are leaf-only + total (§6.7) — a group row can never carry a limit.
    for (const id of categoryIds) {
      if (!(await isAssignableCategory(db, id))) return { ok: false as const, error: "Unknown or non-assignable (group) budget category" };
    }
  }

  // null total means "no total limit" — replaceBudgetScope treats 0 the same.
  await replaceBudgetScope(db, month, totalPaise ?? 0, categoryLimits);

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

  await replaceTotalBudgetRow(db, month, totalPaise);

  revalidatePath("/");
  revalidatePath("/settings");
  revalidateTag("transactions");
  return { ok: true as const };
}

/**
 * §6.7 — global "exclude bills (recurring) from the total budget" toggle.
 * When enabled, every total-budget comparison (dashboard Budget card, ledger
 * month strip, over-budget toast) subtracts the month's recurring spend;
 * per-category budgets are unaffected (owner decision).
 */
export async function setExcludeBills(raw: z.infer<typeof setExcludeBillsSchema>) {
  const parsed = setExcludeBillsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid setting" };

  await setAppSetting(db, EXCLUDE_BILLS_KEY, parsed.data.enabled ? "1" : "0");

  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/settings");
  revalidateTag("transactions"); // dashboard aggregates + the strip are cached under this tag
  return { ok: true as const };
}

/**
 * §6.7 — remaining budget per category for a month, for the Quick Add grid.
 * Effective budget (exact month wins, else the default) minus the category's
 * spend so far in that month. Only categories with a budget are returned;
 * remaining can be negative (over budget).
 */
export async function getCategoryBudgetStatus(monthKey: string) {
  const parsedMonth = monthKeySchema.safeParse(monthKey);
  if (!parsedMonth.success) return { ok: false as const, error: "Invalid month" };
  const key = parsedMonth.data;

  const [budgetRows, spentRows] = await Promise.all([
    budgetsForMonth(db, key),
    db
      .select({
        categoryId: transactions.categoryId,
        total: sql<string>`SUM(${transactions.amount})`,
      })
      .from(transactions)
      .where(and(gte(transactions.date, `${key}-01`), lte(transactions.date, monthEnd(key))))
      .groupBy(transactions.categoryId),
  ]);

  const spent = new Map(spentRows.map((r) => [r.categoryId, rupeesToPaise(r.total)]));
  const categoryStatuses = budgetRows
    .filter((b) => b.categoryId !== null)
    .map((b) => b.categoryId!)
    .filter((id, i, self) => self.indexOf(id) === i)
    .map((categoryId) => {
      const budget = resolveEffectiveBudget(budgetRows, key, categoryId);
      const limitPaise = budget ? rupeesToPaise(budget.amount) : 0;
      return { categoryId, remainingPaise: limitPaise - (spent.get(categoryId) ?? 0) };
    });

  return { ok: true as const, categories: categoryStatuses };
}

function monthEnd(monthKey: string): string {
  const [y, m] = monthKeySchema.parse(monthKey).split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${monthKey}-${String(lastDay).padStart(2, "0")}`;
}
