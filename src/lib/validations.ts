import { z } from "zod";
import { TRANSACTION_TAGS } from "./constants";

/**
 * Single shared UUID schema for mutation ids (§7.1) and the active-member
 * cookie (§3.2). One definition — never duplicated validation logic.
 */
export const idSchema = z.string().uuid();

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
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** HH:MM; the server appends :00 (§5.6). */
  time: z.string().regex(/^\d{2}:\d{2}$/),
});

/**
 * §5.2 discriminated union: expense requires a tag, income forbids one.
 * The same schema validates the client payload and is re-validated by the
 * Server Action before any write.
 */
export const transactionSchema = z.discriminatedUnion("type", [
  transactionBaseSchema.extend({
    type: z.literal("expense"),
    tag: z.enum(TRANSACTION_TAGS),
  }),
  transactionBaseSchema.extend({
    type: z.literal("income"),
    tag: z.union([z.undefined(), z.null()]).optional(),
  }),
]);

export type TransactionInput = z.infer<typeof transactionSchema>;

export const updateCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(50),
  emoji: z.string().trim().min(1).max(8),
  sortOrder: z.number().int(),
});

export const updateMemberSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(50),
  emoji: z.string().trim().min(1).max(8),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sortOrder: z.number().int(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8).max(200),
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
  month: z.union([z.null(), z.string().regex(/^\d{4}-\d{2}$/)]),
  totalPaise: z.number().int().min(0).nullable(),
  categories: z.array(categoryBudgetSchema).max(60),
});

/** §6.7 — inline total-budget edit/clear from the dashboard Budget card. */
export const setTotalBudgetSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  totalPaise: z.number().int().min(0).nullable(),
});
