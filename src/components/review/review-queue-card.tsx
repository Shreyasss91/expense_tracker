"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, CheckCheck, ChevronDown, Tag, Trash2, X } from "lucide-react";
import { getReviewPage, type ReviewItem } from "@/actions/review";
import { acknowledgeTransactionsReview, acknowledgeTransactionReview, assignCategory, deleteTransaction, deleteTransactions } from "@/actions/transactions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CategoryPickerSheet } from "@/components/transactions/category-picker-sheet";
import { TransactionEditDialog } from "@/components/transactions/transaction-edit-dialog";
import { TransactionItem } from "@/components/transactions/transaction-item";
import { emitLedgerMutation, emitSelectionMode } from "@/lib/events";
import { isGenericNote } from "@/lib/generic-notes";
import type { Cursor } from "@/lib/query";
import type { CategoryOption, MemberOption } from "@/components/quick-add/types";

const UNDO_WINDOW_MS = 5000;
const COLLAPSE_KEY = "ledger:review-collapsed";

/**
 * Amendment 20 — the Review tab lives inside the Ledger page as a pinned,
 * collapsible queue of month-end reconciliation items. Rows are full ledger
 * rows: tap to edit (and categorize), long-press/tap to multi-select, swipe
 * to delete — plus the review-specific "No more detail" acknowledgement.
 * Bulk assign/delete share the ledger's server actions and undo window.
 */
export function ReviewQueueCard({
  initialRows,
  nextCursor: initialNextCursor,
  pendingCount: initialPendingCount,
  members,
  categories,
  recentCategoryIds = [],
}: {
  initialRows: ReviewItem[];
  nextCursor: Cursor | null;
  pendingCount: number;
  members: MemberOption[];
  categories: CategoryOption[];
  /** Household's most-used categories (server-derived) for one-tap picks. */
  recentCategoryIds?: string[];
}) {
  const [rows, setRows] = useState<ReviewItem[]>(initialRows);
  const [nextCursor, setNextCursor] = useState<Cursor | null>(initialNextCursor);
  const [pendingCount, setPendingCount] = useState(initialPendingCount);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(initialPendingCount > 0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<ReviewItem | null>(null);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(COLLAPSE_KEY) === "1") setExpanded(false);
    } catch {
      // storage unavailable — default expanded
    }
  }, []);

  function toggleExpanded() {
    setExpanded((v) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0");
      } catch {
        // best-effort persistence
      }
      return !v;
    });
  }

  const loadMore = useCallback(async () => {
    if (!nextCursor || loading) return;
    setLoading(true);
    try {
      const data = await getReviewPage({ cursor: nextCursor });
      setRows((prev) => [...prev, ...data.rows.filter((r) => !prev.some((p) => p.id === r.id))]);
      setNextCursor(data.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [nextCursor, loading]);

  const removeFromQueue = useCallback((id: string) => {
    setRows((prev) => prev.filter((row) => row.id !== id));
    setPendingCount((count) => Math.max(0, count - 1));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleAcknowledge = useCallback(
    async (id: string) => {
      const result = await acknowledgeTransactionReview(id);
      if (!result.ok) {
        toast.error(result.error ?? "Could not acknowledge transaction");
        return;
      }
      removeFromQueue(id);
    },
    [removeFromQueue],
  );

  /** The edit dialog saved this row — re-evaluate its queue membership
   * client-side: it leaves the queue once its note stops being generic (§6.4).
   * (The dialog's updateTransaction already wrote the note + reset reviewedAt.) */
  const handleEdited = useCallback(
    (updated: ReviewItem) => {
      const normalized = updated.note?.trim() || null;
      const redundant = updated.category ? normalized?.toLowerCase() === updated.category.name.trim().toLowerCase() : false;
      if (normalized !== null && !redundant && !isGenericNote(normalized)) {
        removeFromQueue(updated.id);
      } else {
        setRows((prev) => prev.map((item) => (item.id === updated.id ? { ...updated, note: normalized } : item)));
      }
    },
    [removeFromQueue],
  );

  /**
   * Delete from inside the edit dialog (the dialog's own trash button calls
   * onRequestDelete). Previously this was a no-op in the Review context, so
   * tapping Delete in the dialog silently did nothing — no toast, no delete.
   * Mirror the row's own swipe/delete path: optimistic removal from the queue
   * + pending-count decrement, a 5s Undo that restores the original row, and a
   * real server delete once the toast auto-closes (mirrors requestBulkDelete
   * and the row onDelete handler above).
   */
  const handleRequestDelete = useCallback(
    (row: { id: string }) => {
      const original = rows.find((r) => r.id === row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      setPendingCount((c) => Math.max(0, c - 1));
      // §3.3 — commit on every close path (timer, swipe or X); Sonner skips
      // onAutoClose on a user dismiss, which used to strand the delete.
      const commit = () => {
        emitLedgerMutation({ kind: "delete", id: row.id });
        void deleteTransaction(row.id);
      };
      toast("Deleted", {
        duration: UNDO_WINDOW_MS,
        action: {
          label: "Undo",
          onClick: () => {
            if (original) {
              setRows((prev) => [original, ...prev.filter((r) => r.id !== original.id)]);
              emitLedgerMutation({ kind: "update", id: original.id, row: original });
            }
          },
        },
        onAutoClose: commit,
        onDismiss: commit,
      });
    },
    [rows],
  );

  function enterSelection(row: ReviewItem) {
    setSelectionMode(true);
    setSelectedIds(new Set([row.id]));
  }

  function exitSelection() {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setPickerOpen(false);
  }

  // Esc exits selection mode (desktop convenience)
  useEffect(() => {
    if (!selectionMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectionMode]);

  // Broadcast so the bottom nav tucks the + FAB away while the bulk bar is open
  useEffect(() => {
    emitSelectionMode(selectionMode);
    return () => emitSelectionMode(false);
  }, [selectionMode]);

  /** Month-end batch: acknowledge every loaded item in one server call. No
   * undo toast — acknowledgement is reversible by design (any later note edit
   * resets reviewed_at and sends the row back through the queue, §6.4). */
  const [acknowledgingAll, setAcknowledgingAll] = useState(false);
  async function acknowledgeAll() {
    if (rows.length === 0 || acknowledgingAll) return;
    setAcknowledgingAll(true);
    try {
      const res = await acknowledgeTransactionsReview(rows.map((r) => r.id));
      if (!res.ok) {
        toast.error(res.error ?? "Could not acknowledge");
        return;
      }
      setRows([]);
      setSelectedIds(new Set());
      setSelectionMode(false);
      setPendingCount((c) => Math.max(0, c - res.acknowledged));
      toast.success(`Acknowledged ${res.acknowledged} item${res.acknowledged === 1 ? "" : "s"}`);
    } finally {
      setAcknowledgingAll(false);
    }
  }

  const selectedRows = useMemo(() => rows.filter((r) => selectedIds.has(r.id)), [rows, selectedIds]);

  async function handleAssign(categoryId: string | null) {
    const targets = selectedRows;
    if (targets.length === 0) return;
    const originals = targets;
    const category = categoryId ? categories.find((c) => c.id === categoryId) : null;
    const catObj = category
      ? { name: category.name, emoji: category.emoji, color: category.color, slug: category.slug }
      : null;
    for (const t of originals) {
      emitLedgerMutation({
        kind: "update",
        id: t.id,
        row: { ...t, categoryId, category: catObj },
      });
      setRows((prev) => prev.map((r) => (r.id === t.id ? { ...r, categoryId, category: catObj } : r)));
    }
    setPickerOpen(false);
    try {
      const res = await assignCategory(targets.map((t) => t.id), categoryId);
      if (!res.ok) {
        for (const o of originals) {
          emitLedgerMutation({ kind: "update", id: o.id, row: o });
          setRows((prev) => prev.map((r) => (r.id === o.id ? o : r)));
        }
        toast.error(res.error ?? "Could not assign");
        return;
      }
      toast.success(categoryId ? `Categorized ${res.updated}` : `Removed category from ${res.updated}`, {
        duration: UNDO_WINDOW_MS,
        action: {
          label: "Undo",
          onClick: () => {
            // restore each row's previous category (optimistic + server)
            for (const o of originals) {
              emitLedgerMutation({ kind: "update", id: o.id, row: o });
              setRows((prev) => prev.map((r) => (r.id === o.id ? o : r)));
            }
            const groups = new Map<string | null, string[]>();
            for (const o of originals) {
              const arr = groups.get(o.categoryId) ?? [];
              arr.push(o.id);
              groups.set(o.categoryId, arr);
            }
            for (const [cid, ids] of groups) void assignCategory(ids, cid);
          },
        },
      });
    } catch {
      for (const o of originals) {
        emitLedgerMutation({ kind: "update", id: o.id, row: o });
        setRows((prev) => prev.map((r) => (r.id === o.id ? o : r)));
      }
      toast.error("Could not assign");
    }
  }

  function requestBulkDelete() {
    const targets = selectedRows;
    if (targets.length === 0) return;
    const snapshot = [...targets];
    setRows((prev) => prev.filter((r) => !selectedIds.has(r.id)));
    exitSelection();
    // §3.3 — commit on every close path (timer, swipe or X); see handleRequestDelete.
    const commit = () => {
      for (const s of snapshot) emitLedgerMutation({ kind: "delete", id: s.id });
      void deleteTransactions(snapshot.map((s) => s.id));
    };
    toast(`${snapshot.length} deleted`, {
      duration: UNDO_WINDOW_MS,
      action: {
        label: "Undo",
        onClick: () => {
          setRows((prev) => [...snapshot, ...prev.filter((r) => !snapshot.some((s) => s.id === r.id))]);
          for (const s of snapshot) emitLedgerMutation({ kind: "update", id: s.id, row: s });
        },
      },
      onAutoClose: commit,
      onDismiss: commit,
    });
    setPendingCount((c) => Math.max(0, c - snapshot.length));
  }

  const grouped = useMemo(() => {
    const map = new Map<string, ReviewItem[]>();
    for (const r of rows) {
      const month = r.date.slice(0, 7);
      const arr = map.get(month) ?? [];
      arr.push(r);
      map.set(month, arr);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [rows]);

  // Layout pass — collapsed state renders as a thin amber banner (reads as a
  // notification, not a section); expanded keeps the full card.
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={toggleExpanded}
        aria-expanded={false}
        className="flex w-full items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left transition-colors hover:bg-amber-500/20"
      >
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Review</span>
        <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold leading-none text-destructive-foreground">{pendingCount}</span>
        <span className="truncate text-[11px] text-muted-foreground">month-end reconciliation</span>
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 -rotate-90 text-muted-foreground" />
      </button>
    );
  }

  return (
    <Card>
      <CardContent className="p-3">
        <button type="button" onClick={toggleExpanded} className="flex w-full items-center gap-2 text-left" aria-expanded={expanded}>
          <span className="text-sm font-semibold">Review</span>
          <span className="rounded-full bg-destructive px-2 py-0.5 text-[10px] font-bold text-destructive-foreground">{pendingCount}</span>
          <span className="text-xs text-muted-foreground">month-end reconciliation</span>
          <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "" : "-rotate-90"}`} />
        </button>

        {expanded && (
          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground">
                Tap a row to add detail or categorize it — acknowledged items leave the queue.
              </p>
              {rows.length > 0 && (
                selectionMode ? (
                  <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 rounded-full text-xs text-muted-foreground" onClick={exitSelection}>
                    <X className="h-3.5 w-3.5" /> Cancel
                  </Button>
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 rounded-full text-xs text-muted-foreground"
                      onClick={() => void acknowledgeAll()}
                      disabled={acknowledgingAll}
                    >
                      <CheckCheck className="h-3.5 w-3.5" /> {acknowledgingAll ? "Acknowledging…" : "Acknowledge all"}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-7 rounded-full text-xs text-muted-foreground" onClick={() => enterSelection(rows[0])}>
                      Select
                    </Button>
                  </div>
                )
              )}
            </div>

            {rows.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No items pending review ✓</div>
            ) : (
              grouped.map(([month, items]) => (
                <section key={month} className="space-y-2">
                  <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{month}</h4>
                  <div className="space-y-2">
                    {items.map((item) => (
                      <div key={item.id} className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <TransactionItem
                            row={item}
                            onEdit={setEditing}
                            onDelete={(row) => {
                              // §6.4.1-style optimistic delete with undo; the
                              // main ledger list hears about it via the bus.
                              // §3.3 — commit on every close path (timer,
                              // swipe or X), not just the timer.
                              setRows((prev) => prev.filter((r) => r.id !== row.id));
                              setPendingCount((c) => Math.max(0, c - 1));
                              const commit = () => {
                                emitLedgerMutation({ kind: "delete", id: row.id });
                                void deleteTransaction(row.id);
                              };
                              toast("Deleted", {
                                duration: UNDO_WINDOW_MS,
                                action: {
                                  label: "Undo",
                                  onClick: () => {
                                    setRows((prev) => [item, ...prev.filter((r) => r.id !== item.id)]);
                                    emitLedgerMutation({ kind: "update", id: item.id, row: item });
                                  },
                                },
                                onAutoClose: commit,
                                onDismiss: commit,
                              });
                            }}
                            selectionMode={selectionMode}
                            selected={selectedIds.has(item.id)}
                            onSelectToggle={(row) =>
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(row.id)) next.delete(row.id);
                                else next.add(row.id);
                                return next;
                              })
                            }
                            onLongPress={enterSelection}
                          />
                        </div>
                        {!selectionMode && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 shrink-0 rounded-full px-2.5 text-xs"
                            onClick={() => void handleAcknowledge(item.id)}
                          >
                            <Check className="h-3.5 w-3.5" /> Done
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))
            )}

            {nextCursor && (
              <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => void loadMore()} disabled={loading}>
                {loading ? "Loading…" : "Load more"}
              </Button>
            )}
          </div>
        )}

        {/* sticky bulk bar while selecting inside the queue */}
        {selectionMode && (
          <div className="fixed inset-x-0 bottom-[calc(var(--bottom-nav-h)+0.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex w-[calc(100%-2rem)] max-w-md items-center gap-2 rounded-full border bg-background/95 p-2 shadow-lg backdrop-blur md:bottom-4">
            <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-full" onClick={exitSelection} aria-label="Cancel selection">
              <X className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium tabular-nums">{selectedIds.size} selected</span>
            <div className="ml-auto flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" className="h-9 gap-1 rounded-full" disabled={selectedIds.size === 0} onClick={requestBulkDelete}>
                <Trash2 className="h-4 w-4 text-destructive" /> Delete
              </Button>
              <Button type="button" size="sm" className="h-9 gap-1 rounded-full" disabled={selectedIds.size === 0} onClick={() => setPickerOpen(true)}>
                <Tag className="h-4 w-4" /> Assign
              </Button>
            </div>
          </div>
        )}

        <CategoryPickerSheet
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          categories={categories}
          rows={selectedRows}
          onPick={(categoryId) => void handleAssign(categoryId)}
          recentCategoryIds={recentCategoryIds}
        />

        <TransactionEditDialog
          row={editing}
          members={members}
          categories={categories}
          open={editing !== null}
          recentCategoryIds={recentCategoryIds}
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
          onRequestDelete={handleRequestDelete}
          onSaved={handleEdited}
        />
      </CardContent>
    </Card>
  );
}
