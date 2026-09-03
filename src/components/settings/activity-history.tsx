"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { listActivity, restoreActivityEntry } from "@/actions/activity";

interface Entry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: string | null;
  payload: unknown;
  createdAt: Date | string;
}

function describe(e: Entry): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  switch (e.action) {
    case "delete_transaction":
      return "Deleted 1 expense";
    case "delete_transactions":
      return `Deleted ${typeof p.count === "number" ? p.count : (p.transactions as unknown[])?.length ?? "?"} expenses`;
    case "merge_categories":
      return `Merged ${String(p.sourceName ?? "category")} → ${String(p.targetName ?? "category")}`;
    case "skip_template_month":
      return `Skipped template for ${String(p.skipMonth ?? "")}`;
    case "restore_transactions":
      return `Restored ${String((p as Record<string, unknown>).restored ?? "?")} expense(s)`;
    default:
      return `${e.action} (${e.entityType})`;
  }
}

/**
 * §2.12 — persistent audit trail backing the 5 s undo toast.
 * Deletes carry snapshots and can be restored; merges/skips are listed as
 * history (attribution is advisory — the member cookie is editable, §1.8).
 */
export function ActivityHistory() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    void listActivity(30).then((res) => {
      if (res.ok) setEntries(res.entries as Entry[]);
    });
  }, []);

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No changes recorded yet — deletes and merges will appear here.</p>;
  }

  return (
    <ul className="space-y-2">
      {entries.map((e) => {
        const restorable = e.action === "delete_transaction" || e.action === "delete_transactions";
        return (
          <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
            <div className="min-w-0">
              <p className="truncate">{describe(e)}</p>
              <p className="text-[11px] text-muted-foreground">
                {new Date(e.createdAt).toLocaleString()}
                {e.actor ? ` · ${e.actor}` : ""}
              </p>
            </div>
            {restorable && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={restoring === e.id}
                onClick={() => {
                  setRestoring(e.id);
                  void restoreActivityEntry(e.id).then((res) => {
                    setRestoring(null);
                    if (res.ok) toast.success(`Restored ${res.restored} expense(s)`);
                    else toast.error(res.error ?? "Could not restore");
                  });
                }}
              >
                {restoring === e.id ? "Restoring…" : "Restore"}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
