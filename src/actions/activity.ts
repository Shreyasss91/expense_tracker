"use server";

import { auth } from "@/auth";
import { desc, eq, ne } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "@/lib/cache-refresh";
import { db } from "@/db";
import { activityLog, transactions } from "@/db/schema";
import { idSchema } from "@/lib/validations";
import { logActivity } from "@/db/activity-log";
import { restoreValuesFromSnapshot } from "@/lib/transaction-diff";

/**
 * §2.12 / §6.5 — the History surface shows deletes and merges. The daily
 * feed's `update_transaction` entries are **filtered out deliberately**: the
 * edit journal is consumed by the feed only, so §6.5's contract ("every delete
 * and merge with who/when") stays literally true instead of silently widening
 * to every action.
 *
 * An exclusion rather than an explicit allowlist: an allowlist would also drop
 * the `restore_transactions` and `skip_template_month` rows this surface shows
 * today, which is a behaviour change this feature has no business making.
 */
export async function listActivity(limit = 30) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Unauthorized" };
  const rows = await db
    .select()
    .from(activityLog)
    .where(ne(activityLog.action, "update_transaction"))
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
  // D6 — the restored ids are recorded so a delete + Undo inside ONE window can
  // net out. A count alone cannot say which rows came back.
  const restoredIds: string[] = [];
  for (const snap of snapshots) {
    // The snapshot's own `created_at` is carried through on purpose: without it
    // the row would be stamped with the restore instant, and the daily feed —
    // which selects on `created_at` — would report a deleted-and-undone expense
    // as a brand-new Added entry. See `restoreValuesFromSnapshot`.
    const values = restoreValuesFromSnapshot(snap);
    if (!values) continue;
    const [existing] = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, values.id));
    if (existing) continue;
    try {
      await db.insert(transactions).values(values);
      restored += 1;
      restoredIds.push(values.id);
    } catch {
      // skip rows that no longer fit (e.g. member deleted) — restore the rest
    }
  }

  try {
    await logActivity({
      action: "restore_transactions",
      entityType: "transaction",
      entityId: entry.id,
      // `ids` is new: entries written before it are handled by the feed's
      // fallback to the originating delete entry (§5.4.4).
      payload: { from: entry.id, restored, ids: restoredIds },
    });
  } catch {
    // best-effort
  }

  revalidatePath("/");
  revalidatePath("/transactions");
  revalidateTag("transactions");
  return { ok: true as const, restored };
}
