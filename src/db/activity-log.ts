import { db } from "@/db";
import { activityLog } from "@/db/schema";

/**
 * §2.12 — append one audit-trail row. Best-effort: a logging failure must
 * never break the mutation it records, so callers swallow errors.
 */
export async function logActivity(entry: {
  action: string;
  entityType: string;
  entityId?: string | null;
  actor?: string | null;
  payload?: unknown;
}) {
  await db.insert(activityLog).values({
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    actor: entry.actor ?? null,
    payload: (entry.payload ?? null) as never,
  });
}
