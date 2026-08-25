import "server-only";

import { unstable_cache } from "next/cache";
import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, members, templates as templateTable, transactions } from "@/db/schema";
import { rupeesToPaise } from "@/lib/money";
import type { TemplateOption } from "@/components/quick-add/types";

/**
 * Cached lookups for the small, rarely-changing metadata tables. These feed
 * the global header, the Quick Add sheet, the ledger filters and the settings
 * page, so they were previously re-queried on every single navigation. Both
 * caches are invalidated by the settings server actions via
 * revalidateTag("members") / revalidateTag("categories").
 */
export const getMembers = unstable_cache(
  async () => db.select().from(members).orderBy(asc(members.sortOrder)),
  ["family-ledger", "members"],
  { tags: ["members"], revalidate: 300 },
);

export const getCategories = unstable_cache(
  async () => db.select().from(categories).orderBy(asc(categories.sortOrder)),
  ["family-ledger", "categories"],
  { tags: ["categories"], revalidate: 300 },
);

export const getTemplates = unstable_cache(
  async (): Promise<TemplateOption[]> => {
    const rows = await db.select().from(templateTable).orderBy(asc(templateTable.sortOrder), asc(templateTable.name));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      categoryId: row.categoryId,
      tag: row.tag,
      amountPaise: rupeesToPaise(row.amount),
      note: row.note,
      sortOrder: row.sortOrder,
      autoDay: row.autoDay,
      memberId: row.memberId,
    }));
  },
  ["family-ledger", "templates"],
  { tags: ["templates"], revalidate: 300 },
);

/**
 * Household's most-used categories, newest commit first — the "Recent" chips
 * in the category picker. Derived from the transactions table (no extra
 * state to maintain): a category's recency is its latest entry. Cached under
 * the "transactions" tag so any ledger mutation refreshes it; capped at 8.
 */
export const getRecentCategoryIds = unstable_cache(
  async (): Promise<string[]> => {
    const rows = await db
      .select({
        categoryId: transactions.categoryId,
        latest: sql<string>`MAX(${transactions.createdAt})`,
      })
      .from(transactions)
      .where(sql`${transactions.categoryId} IS NOT NULL`)
      .groupBy(transactions.categoryId)
      .orderBy(sql`MAX(${transactions.createdAt}) DESC`)
      .limit(8);
    return rows.map((r) => r.categoryId).filter((id): id is string => id !== null);
  },
  ["family-ledger", "recent-categories"],
  { tags: ["transactions"], revalidate: 60 },
);
