"use client";

import { useCallback, useEffect, useState } from "react";
import { CloudUpload } from "lucide-react";
import { toast } from "sonner";
import { createTransaction } from "@/actions/transactions";
import {
  countPendingAdds,
  emitPendingSync,
  listPendingAdds,
  PENDING_SYNC_EVENT,
  removePendingAdd,
} from "@/lib/offline-queue";

/**
 * Offline Quick Add sync. Mounted once in the app layout; does three jobs:
 *  - replays queued entries through the same createTransaction action when
 *    connectivity returns (online event, tab focus, or a manual nudge)
 *  - exposes requestSync() so the header pill can force an attempt
 *  - renders PendingSyncPill, a small header badge with the waiting count
 */

let syncing = false;

async function runSync() {
  if (syncing || typeof navigator === "undefined" || !navigator.onLine) return;
  const items = await listPendingAdds();
  if (items.length === 0) return;

  syncing = true;
  let synced = 0;
  let blocked = false;
  for (const item of items) {
    try {
      const res = await createTransaction(item.payload);
      if (res.ok) {
        await removePendingAdd(item.clientId);
        synced++;
      } else {
        // The server rejected it — queueing can't fix validation problems
        // (e.g. a category deleted while offline). Keep it and tell the user.
        blocked = true;
      }
    } catch {
      // Network dropped mid-sync — stop and leave the rest queued.
      break;
    }
  }
  syncing = false;

  const remaining = await countPendingAdds();
  emitPendingSync();
  if (remaining === 0 && synced > 0) {
    toast.success(`Synced ${synced} offline ${synced === 1 ? "entry" : "entries"}`);
  } else if (blocked) {
    toast.warning(`${remaining} offline ${remaining === 1 ? "entry needs" : "entries need"} attention`, {
      duration: 8000,
      action: {
        label: "Review",
        onClick: () => {
          window.location.assign("/settings#offline-entries");
        },
      },
    });
  }
}

/** Manual nudge from UI — safe to call anywhere, no-ops while offline/busy. */
export function requestSync() {
  void runSync();
}

export function OfflineSyncManager() {
  useEffect(() => {
    void runSync();
    const onOnline = () => void runSync();
    const onFocus = () => void runSync();
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  return null;
}

/** Header badge — hidden until entries are actually waiting. */
export function PendingSyncPill() {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    setCount(await countPendingAdds());
  }, []);

  useEffect(() => {
    void refresh();
    const onPendingSync = () => void refresh();
    window.addEventListener(PENDING_SYNC_EVENT, onPendingSync);
    return () => window.removeEventListener(PENDING_SYNC_EVENT, onPendingSync);
  }, [refresh]);

  // Also re-check when connectivity returns (the queue may have drained).
  useEffect(() => {
    const onOnline = () => setTimeout(() => void refresh(), 1500);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [refresh]);

  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={() => {
        requestSync();
        toast.info(`Syncing ${count} offline ${count === 1 ? "entry" : "entries"}…`);
      }}
      className="flex h-9 items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted-foreground/10"
      aria-label={`${count} offline ${count === 1 ? "entry" : "entries"} waiting to sync`}
    >
      <CloudUpload className="h-4 w-4" />
      <span className="tabular-nums">{count}</span>
    </button>
  );
}
