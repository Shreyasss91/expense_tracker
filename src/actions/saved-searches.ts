"use server";

import { auth } from "@/auth";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { savedSearches } from "@/db/schema";
import type { LedgerFilters } from "@/lib/ledger-url";

/**
 * §2.7 — saved searches: a household library of named filter presets
 * ("Big fuel spends", "Kid stuff last quarter"). Each preset stores the
 * serialized LedgerFilters so a tap re-applies the exact query. This is the
 * "save this combination" half of making search a real query tool; the
 * filters bar renders the chips and applies them via buildLedgerUrl.
 */

/** Keep only known, safe filter keys; deliberately drop `month` so a saved
 * search stays reusable across months. Guards against arbitrary JSON being
 * persisted from the client. */
function sanitizeParams(input: unknown): LedgerFilters {
  const p = (input ?? {}) as Record<string, unknown>;
  const out: LedgerFilters = {};
  if (typeof p.memberId === "string" && p.memberId) out.memberId = p.memberId;
  if (typeof p.categoryId === "string" && p.categoryId) out.categoryId = p.categoryId;
  if (typeof p.groupId === "string" && p.groupId) out.groupId = p.groupId;
  if (p.uncategorized === true) out.uncategorized = true;
  if (p.tag === "one_time" || p.tag === "recurring" || p.tag === "lifestyle") out.tag = p.tag;
  if (typeof p.from === "string" && p.from) out.from = p.from;
  if (typeof p.to === "string" && p.to) out.to = p.to;
  if (typeof p.amountMin === "string" && p.amountMin) out.amountMin = p.amountMin;
  if (typeof p.amountMax === "string" && p.amountMax) out.amountMax = p.amountMax;
  if (typeof p.q === "string" && p.q.trim()) out.q = p.q.trim();
  return out;
}

export async function listSavedSearches() {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Unauthorized" };
  try {
    const rows = await db
      .select({ id: savedSearches.id, name: savedSearches.name, params: savedSearches.params, createdAt: savedSearches.createdAt })
      .from(savedSearches)
      .orderBy(savedSearches.createdAt);
    return {
      ok: true as const,
      searches: rows.map((r) => ({
        id: r.id,
        name: r.name,
        params: r.params as LedgerFilters,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  } catch (error) {
    console.error("listSavedSearches failed", error);
    return { ok: false as const, error: "Could not load saved searches" };
  }
}

export async function saveSearch(name: string, params: unknown) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Unauthorized" };
  const cleanName = name.trim().slice(0, 40);
  if (!cleanName) return { ok: false as const, error: "Name is required" };
  const cleanParams = sanitizeParams(params);
  try {
    const [row] = await db
      .insert(savedSearches)
      .values({ id: randomUUID(), name: cleanName, params: cleanParams })
      .returning({ id: savedSearches.id });
    if (!row) return { ok: false as const, error: "Could not save search" };
    revalidatePath("/transactions");
    return { ok: true as const, id: row.id };
  } catch (error) {
    console.error("saveSearch failed", error);
    return { ok: false as const, error: "Could not save search" };
  }
}

export async function deleteSavedSearch(id: string) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Unauthorized" };
  if (typeof id !== "string" || !id) return { ok: false as const, error: "Invalid id" };
  try {
    await db.delete(savedSearches).where(eq(savedSearches.id, id));
    revalidatePath("/transactions");
    return { ok: true as const };
  } catch (error) {
    console.error("deleteSavedSearch failed", error);
    return { ok: false as const, error: "Could not delete search" };
  }
}
