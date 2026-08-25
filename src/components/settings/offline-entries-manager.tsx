"use client";

import { useCallback, useEffect, useState } from "react";
import { CloudUpload, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatINRWhole } from "@/lib/money";
import { displayTime } from "@/lib/dates";
import { listPendingAdds, removePendingAdd, PENDING_SYNC_EVENT, type PendingAdd } from "@/lib/offline-queue";
import { requestSync } from "@/components/pwa/offline-sync";
import type { MemberOption } from "@/components/quick-add/types";

/**
 * Settings surface for offline Quick Add entries that are still waiting on
 * the device queue. The sync manager replays them automatically; this card
 * covers the edge cases — inspecting what's queued, forcing a retry, and
 * discarding an entry the family decided against after the fact.
 */
export function OfflineEntriesManager({ members }: { members: MemberOption[] }) {
  const [items, setItems] = useState<PendingAdd[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setItems(await listPendingAdds());
  }, []);

  useEffect(() => {
    void refresh();
    const onPendingSync = () => void refresh();
    window.addEventListener(PENDING_SYNC_EVENT, onPendingSync);
    window.addEventListener("focus", onPendingSync);
    return () => {
      window.removeEventListener(PENDING_SYNC_EVENT, onPendingSync);
      window.removeEventListener("focus", onPendingSync);
    };
  }, [refresh]);

  async function discard(item: PendingAdd) {
    setBusy(item.clientId);
    await removePendingAdd(item.clientId);
    setBusy(null);
    setItems((current) => current.filter((i) => i.clientId !== item.clientId));
    toast.success("Offline entry discarded");
  }

  function retryAll() {
    requestSync();
    toast.info(`Retrying ${items.length} offline ${items.length === 1 ? "entry" : "entries"}…`);
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing waiting — entries added while offline appear here until they sync.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {items.length} offline {items.length === 1 ? "entry" : "entries"} waiting to sync
        </p>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 rounded-full" onClick={retryAll}>
          <CloudUpload className="size-3.5" /> Sync now
        </Button>
      </div>
      <ul className="space-y-2">
        {items.map((item) => {
          const member = members.find((m) => m.id === item.payload.memberId);
          return (
            <li key={item.clientId} className="flex items-center gap-2 rounded-lg border p-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium tabular-nums">
                  {formatINRWhole(item.payload.amount)} · {item.payload.date} {displayTime(item.payload.time)}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {member ? `${member.emoji} ${member.name}` : "Unknown member"}
                  {item.payload.note ? ` · ${item.payload.note}` : ""}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-destructive"
                aria-label="Discard offline entry"
                disabled={busy === item.clientId}
                onClick={() => void discard(item)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
