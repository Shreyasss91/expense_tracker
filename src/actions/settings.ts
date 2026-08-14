"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, members } from "@/db/schema";
import { updateCategorySchema, updateMemberSchema } from "@/lib/validations";
import { z } from "zod";

/**
 * §6.5 — categories: rename, emoji, reorder ONLY.
 * The slug (§5.3) is immutable and never touched here; deletion is not offered in v1.
 */
export async function updateCategory(raw: z.infer<typeof updateCategorySchema>) {
  const parsed = updateCategorySchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid category data" };
  await db
    .update(categories)
    .set({ name: parsed.data.name, emoji: parsed.data.emoji, sortOrder: parsed.data.sortOrder })
    .where(eq(categories.id, parsed.data.id));
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/settings");
  revalidateTag("transactions");
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
  return { ok: true as const };
}
