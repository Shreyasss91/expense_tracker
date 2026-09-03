"use server";

import { auth } from "@/auth";
import { desc, eq } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { db } from "@/db";
import { activityLog, transactions } from "@/db/schema";
import { idSchema } from "@/lib/validations";
import { logActivity } from "@/db/activity-log";

export async function listActivity(limit = 30) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Unauthorized" };
  const rows = await db
    .select()
    .from(activityLog)
    .orderBy(desc(activityLog.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return { ok: true as const, entries: rows };
}

type DeletedPayload = {
  transactions?: Array<Record<string, unknown>>;
};

/**
 * §2.12 — restore deleted transactions from an audit-trail entry.
 * Re-inserts the snapshotted rows with their original ids (guarded by
 * on-conflict-do-nothing semantics via a pre-check, since neon-http has no
 * transactions). Merge entries are not restorable — history moved forward.
 */
export async function restoreActivityEntry(id: string) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Unauthorized" };
  const idCheck = idSchema.safeParse(id);
  if (!idCheck.success) return { ok: false as const, error: "Invalid entry id" };

  const [entry] = await db.select().from(activityLog).where(eq(activityLog.id, idCheck.data));
  if (!entry) return { ok: false as const, error: "Entry not found" };
  if (entry.action !== "delete_transaction" && entry.action !== "delete_transactions") {
    return { ok: false as const, error: "Only deleted transactions can be restored" };
  }

  const payload = (entry.payload ?? {}) as DeletedPayload;
  const snapshots = Array.isArray(payload.transactions) ? payload.transactions : [];
  if (snapshots.length === 0) return { ok: false as const, error: "Nothing to restore" };

  let restored = 0;
  for (const snap of snapshots) {
    if (typeof snap.id !== "string") continue;
    const [existing] = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, snap.id));
    if (existing) continue;
    try {
      await db.insert(transactions).values({
        id: snap.id as string,
        memberId: snap.memberId as string,
        categoryId: (snap.categoryId as string | null) ?? null,
        tag: snap.tag as "one_time" | "recurring" | "lifestyle",
        amount: snap.amount as string,
        note: (snap.note as string | null) ?? null,
        date: snap.date as string,
        time: snap.time as string,
        shared: (snap.shared as boolean) ?? false,
        splitWith: (snap.splitWith as string[]) ?? [],
      });
      restored += 1;
    } catch {
      // skip rows that no longer fit (e.g. member deleted) — restore the rest
    }
  }

  try {
    await logActivity({
      action: "restore_transactions",
      entityType: "transaction",
      entityId: entry.id,
      payload: { from: entry.id, restored },
    });
  } catch {
    // best-effort
  }

  revalidatePath("/");
  revalidatePath("/transactions");
  revalidateTag("transactions");
  return { ok: true as const, restored };
}
