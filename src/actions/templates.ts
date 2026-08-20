"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, templates } from "@/db/schema";
import { paiseToDbString } from "@/lib/money";
import { idSchema, templateSchema, type TemplateInput } from "@/lib/validations";

export async function createTemplate(raw: TemplateInput) {
  const parsed = templateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid template data" };

  const data = parsed.data;

  // Validate category exists (no member check — templates carry no member)
  const categoryExists = await db.query.categories.findFirst({ where: eq(categories.id, data.categoryId) });
  if (!categoryExists) return { ok: false as const, error: "Unknown category" };

  const [maxRow] = await db.select({ max: sql<number>`COALESCE(MAX(${templates.sortOrder}), 0)` }).from(templates);
  const [row] = await db
    .insert(templates)
    .values({
      id: randomUUID(),
      name: data.name,
      categoryId: data.categoryId,
      tag: data.tag,
      amount: paiseToDbString(data.amount),
      note: data.note ?? null,
      sortOrder: data.sortOrder ?? Number(maxRow?.max ?? 0) + 1,
    })
    .returning();

  revalidateTag("templates");
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/settings");

  return { ok: true as const, id: row.id };
}

export async function updateTemplate(id: string, raw: TemplateInput) {
  const idCheck = idSchema.safeParse(id);
  if (!idCheck.success) return { ok: false as const, error: "Invalid template id" };

  const parsed = templateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid template data" };
  const data = parsed.data;

  const categoryExists = await db.query.categories.findFirst({ where: eq(categories.id, data.categoryId) });
  if (!categoryExists) return { ok: false as const, error: "Unknown category" };

  const [row] = await db
    .update(templates)
    .set({
      name: data.name,
      categoryId: data.categoryId,
      tag: data.tag,
      amount: paiseToDbString(data.amount),
      note: data.note ?? null,
      ...(data.sortOrder === undefined ? {} : { sortOrder: data.sortOrder }),
      updatedAt: new Date(),
    })
    .where(eq(templates.id, idCheck.data))
    .returning();

  if (!row) return { ok: false as const, error: "Template not found" };

  revalidateTag("templates");
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/settings");

  return { ok: true as const, id: row.id };
}

export async function deleteTemplate(id: string) {
  const idCheck = idSchema.safeParse(id);
  if (!idCheck.success) return { ok: false as const, error: "Invalid template id" };

  const [row] = await db.delete(templates).where(eq(templates.id, idCheck.data)).returning({ id: templates.id });
  if (!row) return { ok: false as const, error: "Template not found" };

  revalidateTag("templates");
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/settings");
  return { ok: true as const };
}
