import { z } from "zod";
import { TRANSACTION_TAGS } from "./constants";

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
