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
  categoryId: z.string().uuid(),
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

/** §6.2/§6.5 — inline category creation from Quick Add; emoji defaults to 🏷️ when omitted. */
export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(50),
  emoji: z.string().trim().max(8).optional(),
});

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

/**
 * §6.7 saveBudgets payload. `month` is 'yyyy-MM' for a single month or null
 * for the default that applies to every month. `totalPaise` is the total
 * monthly limit (null/0 = no total limit); `categories` carries per-category
 * limits — any with paise 0 are simply not stored.
 */
export const saveBudgetsSchema = z.object({
  month: z.union([z.null(), monthKeySchema]),
  totalPaise: z.number().int().min(0).nullable(),
  categories: z.array(categoryBudgetSchema).max(60),
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
