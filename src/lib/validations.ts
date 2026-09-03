import { z } from "zod";
import { TRANSACTION_TAGS } from "./constants";

/**
 * Single shared UUID schema for mutation ids (§7.1) and the active-member
 * cookie (§3.2). One definition — never duplicated validation logic.
 */
export const idSchema = z.string().uuid();

/** Validate a real calendar date, not merely its YYYY-MM-DD shape. */
export const dateSchema = z.string().refine((value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, "Invalid calendar date; expected YYYY-MM-DD");

/** Validate a real 24-hour clock time in HH:MM form. */
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid time; expected HH:MM");

/** Validate a real calendar month in YYYY-MM form. */
export const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Invalid month; expected YYYY-MM");

export const transactionBaseSchema = z.object({
  memberId: z.string().uuid(),
  /** Amendment 20 — optional/nullable: Quick Add captures without a category. */
  categoryId: z.string().uuid().optional().nullable(),
  /** Integer paise (§5.8). */
  amount: z.number().int().positive(),
  note: z
    .string()
    .trim()
    .max(200)
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : v)),
  /** YYYY-MM-DD, IST calendar date (§5.7). */
  date: dateSchema,
  /** HH:MM; the server appends :00 (§5.6). */
  time: timeSchema,
  // §2.2 — per-expense shared ownership. `shared` flags a household expense;
  // `splitWith` names the members to split among (empty = everyone).
  shared: z.boolean().optional().default(false),
  splitWith: z.array(z.string().uuid()).max(20).optional().default([]),
});

/** Expense-only transaction input shared by the client and Server Actions. */
export const transactionSchema = transactionBaseSchema.extend({
  tag: z.enum(TRANSACTION_TAGS),
});

export type TransactionInput = z.infer<typeof transactionSchema>;

/** §6.5 template input for create/updateTemplate actions. */
export const templateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  categoryId: z.string().uuid(),
  tag: z.enum(TRANSACTION_TAGS),
  amount: z.number().int().positive(),
  note: z
    .string()
    .trim()
    .max(140)
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : v)),
  sortOrder: z.number().int().min(0).optional(),
  // Recurring auto-entry (UX pass): day of month the daily cron stamps the
  // template; null/undefined = manual-only. Days 29–31 are excluded so short
  // months never skip or double-fire.
  autoDay: z.number().int().min(1).max(28).nullable().optional(),
  // Whose ledger the auto entry lands under; null/undefined = household
  // default (first member). Existence is checked server-side.
  memberId: z.string().uuid().nullable().optional(),
  // §2.12 — template controls: paused never auto-stamps; variable stays
  // manual-only; skipMonth ("YYYY-MM") skips the auto-stamp exactly once.
  // Optional so existing manual-only callers keep compiling.
  isPaused: z.boolean().optional(),
  isVariable: z.boolean().optional(),
  skipMonth: monthKeySchema.nullable().optional(),
});

export type TemplateInput = z.infer<typeof templateSchema>;

export const reviewNoteSchema = z
  .string()
  .trim()
  .max(140)
  .nullable()
  .transform((value) => (value === "" ? null : value));

export const updateCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(50),
  emoji: z.string().trim().min(1).max(8),
  sortOrder: z.number().int(),
});

/** §6.2/§6.5 — inline category creation from Quick Add; emoji defaults to 🏷️ when omitted.
 * Two-level hierarchy: `parentId` names the destination group (a top-level row);
 * when omitted the server files the new leaf under the "Other" group. */
export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(50),
  emoji: z.string().trim().max(8).optional(),
  parentId: z.string().uuid().optional(),
});

/** Settings — create a new top-level group (container for leaf categories). */
export const createCategoryGroupSchema = z.object({
  name: z.string().trim().min(1).max(50),
  emoji: z.string().trim().max(8).optional(),
});

/** Settings — move a leaf category to another top-level group. */
export const moveCategoryToGroupSchema = z.object({
  categoryId: z.string().uuid(),
  groupId: z.string().uuid(),
});

/** §2.12 — merge two leaf categories: re-point history then delete the source. */
export const mergeCategoriesSchema = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
}).refine((v) => v.sourceId !== v.targetId, "Source and target must differ");

export const updateMemberSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(50),
  emoji: z.string().trim().min(1).max(8),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sortOrder: z.number().int(),
});

/** One category budget row: the category id + its limit in paise (0 = no limit). */
export const categoryBudgetSchema = z.object({
  categoryId: z.string().uuid(),
  paise: z.number().int().min(0),
});

/** §2.1 — one group budget row: a top-level group id + its limit in paise (0 = no limit). */
export const groupBudgetSchema = z.object({
  groupId: z.string().uuid(),
  paise: z.number().int().min(0),
});

/**
 * §6.7 / §2.1 saveBudgets payload. `month` is 'yyyy-MM' for a single month or
 * null for the default that applies to every month. `totalPaise` is the total
 * monthly limit (null/0 = no total limit); `categories` carries per-category
 * limits and `groups` carries per-group limits (§2.1) — any with paise 0 are
 * simply not stored.
 */
export const saveBudgetsSchema = z.object({
  month: z.union([z.null(), monthKeySchema]),
  totalPaise: z.number().int().min(0).nullable(),
  categories: z.array(categoryBudgetSchema).max(60),
  groups: z.array(groupBudgetSchema).max(60).optional().default([]),
});

/** §6.7 — inline total-budget edit/clear from the dashboard Budget card. */
export const setTotalBudgetSchema = z.object({
  month: monthKeySchema,
  totalPaise: z.number().int().min(0).nullable(),
});

/** §6.7 — global "exclude bills (recurring) from the total budget" toggle. */
export const setExcludeBillsSchema = z.object({
  enabled: z.boolean(),
});
