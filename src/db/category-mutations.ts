import { eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { categories } from "./schema";

export interface CategoryRenameInput {
  id: string;
  name: string;
  emoji: string;
  sortOrder: number;
}

/**
 * The exact mutation `updateCategory` runs, extracted from the server action
 * so the rename round-trip test (src/db/category-rename-test.ts) can drive
 * it without the Next.js runtime (revalidate calls). `db` is parameterized
 * because the app's client is server-only; the test builds its own.
 */
export async function renameCategory<TSchema extends Record<string, unknown>>(
  db: NeonHttpDatabase<TSchema>,
  input: CategoryRenameInput,
): Promise<void> {
  await db
    .update(categories)
    .set({ name: input.name, emoji: input.emoji, sortOrder: input.sortOrder })
    .where(eq(categories.id, input.id));
}

/**
 * Two-level hierarchy invariant: only LEAF categories are assignable.
 * A leaf is a row whose parent_id is set; NULL parent_id marks a group row
 * (or a legacy top-level row), and groups must never end up on a
 * transaction, template or budget — spend rolls up to groups through their
 * leaves, so a direct reference would double-count.
 */
export async function isAssignableCategory<TSchema extends Record<string, unknown>>(
  db: NeonHttpDatabase<TSchema>,
  categoryId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ parentId: categories.parentId })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);
  return row !== undefined && row.parentId !== null;
}
