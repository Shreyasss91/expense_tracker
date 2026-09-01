"use server";

import { auth } from "@/auth";
import { randomUUID } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { members, templates } from "@/db/schema";
import { isAssignableCategory } from "@/db/category-mutations";
import { paiseToDbString } from "@/lib/money";
import { idSchema, templateSchema, type TemplateInput } from "@/lib/validations";

export async function createTemplate(raw: TemplateInput) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Unauthorized" };
  const parsed = templateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid template data" };

  const data = parsed.data;

  // Validate category exists and is a leaf (groups are never assignable)
  if (!(await isAssignableCategory(db, data.categoryId))) return { ok: false as const, error: "Unknown or non-assignable category" };

  // Recurring auto-entry — the chosen member must be real when set.
  if (data.memberId) {
    const memberExists = await db.query.members.findFirst({ where: eq(members.id, data.memberId) });
    if (!memberExists) return { ok: false as const, error: "Unknown member" };
  }

  const [maxRow] = await db.select({ max: sql<number>`COALESCE(MAX(${templates.sortOrder}), 0)` }).from(templates);
  // §1.10 — guard the mutation (typed error instead of an unhandled throw) and
  // ensure row.id is never read off an undefined insert result.
  try {
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
        autoDay: data.autoDay ?? null,
        memberId: data.memberId ?? null,
      })
      .returning();

    if (!row) return { ok: false as const, error: "Failed to create template" };

    revalidateTag("templates");
    revalidatePath("/");
    revalidatePath("/transactions");
    revalidatePath("/settings");

    return { ok: true as const, id: row.id };
  } catch (error) {
    console.error("createTemplate failed", error);
    return { ok: false as const, error: "Could not save the template" };
  }
}

export async function updateTemplate(id: string, raw: TemplateInput) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Unauthorized" };
  const idCheck = idSchema.safeParse(id);
  if (!idCheck.success) return { ok: false as const, error: "Invalid template id" };

  const parsed = templateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid template data" };
  const data = parsed.data;

  if (!(await isAssignableCategory(db, data.categoryId))) return { ok: false as const, error: "Unknown or non-assignable category" };

  if (data.memberId) {
    const memberExists = await db.query.members.findFirst({ where: eq(members.id, data.memberId) });
    if (!memberExists) return { ok: false as const, error: "Unknown member" };
  }

  // §1.10 — fetch the stored row so we can detect an autoDay change. The
  // idempotency marker (lastAutoKey) must survive a member/category edit, but
  // if the user moves the auto-day (e.g. 5 → 20) after it already fired this
  // month, the marker still equals this month's key and the bill would never
  // fire again — so reset it to NULL only when the day actually changes.
  const existing = await db.query.templates.findFirst({ where: eq(templates.id, idCheck.data) });
  if (!existing) return { ok: false as const, error: "Template not found" };
  const autoDayChanged = data.autoDay != null && data.autoDay !== existing.autoDay;

  const [row] = await db
    .update(templates)
    .set({
      name: data.name,
      categoryId: data.categoryId,
      tag: data.tag,
      amount: paiseToDbString(data.amount),
      note: data.note ?? null,
      ...(data.sortOrder === undefined ? {} : { sortOrder: data.sortOrder }),
      autoDay: data.autoDay ?? null,
      // A member/category change must not re-fire the current month's auto
      // entry — keep the idempotency marker untouched here; the cron owns it.
      // Only an autoDay change clears it (see autoDayChanged above).
      ...(autoDayChanged ? { lastAutoKey: null } : {}),
      memberId: data.memberId ?? null,
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
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Unauthorized" };
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
