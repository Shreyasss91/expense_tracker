import "server-only";

import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { sendWebPush, type PushTarget, type SendStatus } from "@/lib/web-push";

/**
 * The web-push fan-out, extracted from `pingDigestReady` so the daily feed's
 * 22:15 fallback cron can reuse it verbatim instead of re-implementing it.
 *
 * Two behaviours are load-bearing and must not be lost in a refactor:
 *   - one failing device never aborts the loop (`sendWebPush` resolves to
 *     `failed` rather than throwing);
 *   - endpoints answering **404/410** are purged, because a revoked permission
 *     must not keep us POSTing to a dead endpoint forever.
 */

export interface PushNotification {
  title: string;
  body: string;
  url: string;
}

export interface PushDispatchResult {
  sent: number;
  failed: number;
  stale: number;
}

/**
 * Deliver one notification to every given subscription.
 *
 * The caller fetches the rows (it usually needs the count first — a zero-device
 * install must not consume the at-most-once marker), so this stays a pure
 * fan-out with no query of its own.
 */
export async function deliverPushToAllDevices(
  subscribers: PushTarget[],
  notification: PushNotification,
): Promise<PushDispatchResult> {
  let sent = 0;
  let failed = 0;
  const staleEndpoints: string[] = [];

  for (const sub of subscribers) {
    let status: SendStatus;
    try {
      status = await sendWebPush({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, notification);
    } catch {
      status = "failed";
    }
    if (status === "sent") sent += 1;
    else if (status === "failed") failed += 1;
    else staleEndpoints.push(sub.endpoint);
  }

  if (staleEndpoints.length > 0) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, staleEndpoints));
  }

  return { sent, failed, stale: staleEndpoints.length };
}
