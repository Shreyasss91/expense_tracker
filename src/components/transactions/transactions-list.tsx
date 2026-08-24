"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ListChecks, Tag, Trash2, X } from "lucide-react";
import { getTransactionsPage, deleteTransaction, deleteTransactions, assignCategory } from "@/actions/transactions";
import { LEDGER_MUTATION_EVENT, type LedgerMutation } from "@/lib/events";
import { emitLedgerMutation } from "@/lib/events";
import { dateGroupLabel } from "@/lib/dates";
import type { Cursor, TransactionListFilters, TransactionListRow } from "@/lib/query";
import type { CategoryOption, MemberOption } from "@/components/quick-add/types";
import { TransactionItem } from "./transaction-item";
import { TransactionEditDialog } from "./transaction-edit-dialog";
import { CategoryPickerSheet } from "./category-picker-sheet";
import { Button } from "@/components/ui/button";

const UNDO_WINDOW_MS = 5000; // §6.4.1 ~5 seconds

/** §7.3 total order: date DESC, time DESC, created_at DESC, id DESC. */
function compareRows(a: TransactionListRow, b: TransactionListRow): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.time !== b.time) return a.time < b.time ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
}

/**
 * Mirror of the server-side WHERE clause so optimistic rows only appear when
 * they actually satisfy the active filters (member/category/tag/month/search).
 */
function matchesFilters(row: TransactionListRow, f: TransactionListFilters): boolean {
  if (f.memberId && row.memberId !== f.memberId) return false;
  if (f.categoryId) {
    if (row.categoryId !== f.categoryId) return false;
  } else if (f.uncategorized && row.categoryId !== null) return false;
  if (f.tag && row.tag !== f.tag) return false;
  if (f.month && !row.date.startsWith(f.month)) return false;
  if (f.search?.trim()) {
    const q = f.search.trim().toLowerCase();
    if (!(row.note ?? "").toLowerCase().includes(q)) return false;
  }
  return true;
}

export function TransactionsList({
  initialRows,
  initialCursor,
  filters,
  members,
  categories,
}: {
  initialRows: TransactionListRow[];
  initialCursor: Cursor | null;
  filters: TransactionListFilters;
  members: MemberOption[];
  categories: CategoryOption[];
}) {
  const [rows, setRows] = useState<TransactionListRow[]>(initialRows);
  const [cursor, setCursor] = useState<Cursor | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<TransactionListRow | null>(null);
  // Amendment 20 — multi-select for bulk categorize / bulk delete
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);

  // §6.4.1 pending deletes: optimistic rows + timers flushed on unmount
  const pendingRef = useRef(new Map<string, { row: TransactionListRow; index: number; fired: boolean }>());
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const refreshFirstPage = useCallback(async () => {
    const res = await getTransactionsPage({ cursor: null, filters });
    setRows(res.rows);
    setCursor(res.nextCursor);
  }, [filters]);

  // §6.4.1 flush: a row must never appear deleted while still in the database
  useEffect(() => {
    const pending = pendingRef.current;
    return () => {
      for (const [id, p] of pending) {
        if (!p.fired) {
          p.fired = true;
          void deleteTransaction(id);
        }
      }
    };
  }, []);

  // Apply optimistic mutations locally; only settings renames fall back to a refetch.
  useEffect(() => {
    const onMutation = (e: Event) => {
      const m = (e as CustomEvent<LedgerMutation>).detail;
      switch (m.kind) {
        case "create": {
          if (!matchesFilters(m.row, filters)) return;
          setRows((prev) => [...prev.filter((r) => r.id !== m.tempId), m.row].sort(compareRows));
          break;
        }
        case "create-confirm": {
          setRows((prev) => prev.map((r) => (r.id === m.tempId ? { ...r, id: m.id } : r)));
          break;
        }
        case "create-revert": {
          setRows((prev) => prev.filter((r) => r.id !== m.tempId));
          break;
        }
        case "update": {
          setRows((prev) => {
            const exists = prev.some((r) => r.id === m.id);
            if (!exists) {
              // e.g. a failed-edit revert restoring a row that was optimistically
              // removed because the new values stopped matching the active filters
              if (!matchesFilters(m.row, filters)) return prev;
              return [...prev, m.row].sort(compareRows);
            }
            if (!matchesFilters(m.row, filters)) return prev.filter((r) => r.id !== m.id);
            return prev.map((r) => (r.id === m.id ? m.row : r)).sort(compareRows);
          });
          break;
        }
        case "delete": {
          // deleted on another surface (Review queue) — drop it here too
          setRows((prev) => prev.filter((r) => r.id !== m.id));
          break;
        }
        case "refetch": {
          void refreshFirstPage();
          break;
        }
      }
    };
    window.addEventListener(LEDGER_MUTATION_EVENT, onMutation);
    return () => window.removeEventListener(LEDGER_MUTATION_EVENT, onMutation);
  }, [filters, refreshFirstPage]);

  // §7.3 infinite scroll — keyset pagination, page size 50
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && cursor && !loading) {
          void loadMore();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, loading]);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    const res = await getTransactionsPage({ cursor, filters });
    setRows((prev) => {
      const seen = new Set(prev.map((r) => r.id));
      return [...prev, ...res.rows.filter((r) => !seen.has(r.id))];
    });
    setCursor(res.nextCursor);
    setLoading(false);
  }

  function requestDelete(row: TransactionListRow) {
    const index = rows.findIndex((r) => r.id === row.id);
    // 1. optimistic removal from UI only — no server call yet (§6.4.1)
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    pendingRef.current.set(row.id, { row, index, fired: false });

    // 2. toast with Undo + ~5s window (§6.4.1)
    toast("Transaction deleted", {
      duration: UNDO_WINDOW_MS,
      action: {
        label: "Undo",
        onClick: () => {
          // 3. Undo: cancel the timer; no database write ever occurred (§6.4.1)
          const p = pendingRef.current.get(row.id);
          pendingRef.current.delete(row.id);
          if (p && !p.fired) {
            setRows((prev) => {
              const next = [...prev];
              next.splice(Math.min(p.index, next.length), 0, p.row);
              return next;
            });
          }
        },
      },
      // 4. timer lapses → hard delete fires (§6.4.1)
      onAutoClose: () => {
        const p = pendingRef.current.get(row.id);
        if (p && !p.fired) {
          p.fired = true;
          void deleteTransaction(row.id);
        }
      },
    });
  }

  // ── Amendment 20: multi-select + bulk actions ────────────────────────────

  function enterSelection(row: TransactionListRow) {
    setSelectionMode(true);
    setSelectedIds(new Set([row.id]));
  }

  function toggleSelected(row: TransactionListRow) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
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

  /** Select every loaded row, or clear the selection when everything is already
   * selected. Honest scope: the loaded pages, not the whole filtered set. */
  const allSelected = rows.length > 0 && selectedIds.size === rows.length;
  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  const selectedRows = useMemo(() => rows.filter((r) => selectedIds.has(r.id)), [rows, selectedIds]);

  /** Optimistically patch every selected row's category through the update bus. */
  function emitCategoryPatch(targets: TransactionListRow[], categoryId: string | null) {
    const category = categoryId ? categories.find((c) => c.id === categoryId) : null;
    const catObj = category
      ? { name: category.name, emoji: category.emoji, color: category.color, slug: category.slug }
      : null;
    for (const t of targets) {
      emitLedgerMutation({
        kind: "update",
        id: t.id,
        row: { ...t, categoryId, category: catObj },
      });
    }
  }

  async function handleAssign(categoryId: string | null) {
    const targets = selectedRows;
    if (targets.length === 0) return;
    const originals = targets;
    emitCategoryPatch(targets, categoryId);
    exitSelection();
    try {
      const res = await assignCategory(targets.map((t) => t.id), categoryId);
      if (!res.ok) {
        for (const o of originals) emitLedgerMutation({ kind: "update", id: o.id, row: o });
        toast.error(res.error ?? "Could not assign");
        return;
      }
      toast.success(
        categoryId ? `Categorized ${res.updated} transaction${res.updated === 1 ? "" : "s"}` : `Removed category from ${res.updated} transaction${res.updated === 1 ? "" : "s"}`,
        {
          duration: UNDO_WINDOW_MS,
          action: {
            label: "Undo",
            onClick: () => {
              // restore each row's previous category (optimistic + server)
              for (const o of originals) emitLedgerMutation({ kind: "update", id: o.id, row: o });
              const groups = new Map<string | null, string[]>();
              for (const o of originals) {
                const arr = groups.get(o.categoryId) ?? [];
                arr.push(o.id);
                groups.set(o.categoryId, arr);
              }
              for (const [cid, ids] of groups) void assignCategory(ids, cid);
            },
          },
        },
      );
    } catch {
      for (const o of originals) emitLedgerMutation({ kind: "update", id: o.id, row: o });
      toast.error("Could not assign");
    }
  }

  function requestBulkDelete() {
    const targets = selectedRows;
    if (targets.length === 0) return;
    const snapshot = targets.map((row) => ({ row, index: rows.findIndex((r) => r.id === row.id), fired: false }));
    // 1. optimistic removal of the whole batch — no server call yet (§6.4.1)
    setRows((prev) => prev.filter((r) => !selectedIds.has(r.id)));
    for (const s of snapshot) pendingRef.current.set(s.row.id, s);
    exitSelection();

    // 2/3/4. one undoable toast drives the batch (same window as single delete)
    toast(`${snapshot.length} transaction${snapshot.length === 1 ? "" : "s"} deleted`, {
      duration: UNDO_WINDOW_MS,
      action: {
        label: "Undo",
        onClick: () => {
          const restore: typeof snapshot = [];
          for (const s of snapshot) {
            const p = pendingRef.current.get(s.row.id);
            pendingRef.current.delete(s.row.id);
            if (p && !p.fired) restore.push(s);
          }
          if (restore.length > 0) {
            setRows((prev) => {
              const next = [...prev];
              for (const s of restore) next.splice(Math.min(s.index, next.length), 0, s.row);
              return next.sort(compareRows);
            });
          }
        },
      },
      onAutoClose: () => {
        const ids: string[] = [];
        for (const s of snapshot) {
          const p = pendingRef.current.get(s.row.id);
          if (p && !p.fired) {
            p.fired = true;
            ids.push(s.row.id);
          }
        }
        if (ids.length > 0) void deleteTransactions(ids);
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────

  const groups = useMemo(() => {
    const map = new Map<string, TransactionListRow[]>();
    for (const r of rows) {
      const label = dateGroupLabel(r.date);
      const arr = map.get(label) ?? [];
      arr.push(r);
      map.set(label, arr);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <div className="space-y-4">
      {/* selection entry point / status — desktop users have no long-press */}
      <div className="flex items-center justify-end">
        {!selectionMode ? (
          rows.length > 0 && (
            <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 rounded-full text-xs text-muted-foreground" onClick={() => enterSelection(rows[0])}>
              <ListChecks className="h-3.5 w-3.5" /> Select
            </Button>
          )
        ) : (
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 rounded-full text-xs text-muted-foreground" onClick={exitSelection}>
            <X className="h-3.5 w-3.5" /> Cancel selection
          </Button>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <span className="text-3xl">🗒️</span>
          <p className="mt-2 text-sm font-medium">No transactions found</p>
          <p className="text-xs text-muted-foreground">Try clearing filters, or tap + to add one.</p>
        </div>
      ) : (
        groups.map(([label, items]) => (
          <section key={label}>
            <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
            <div className="space-y-2">
              {items.map((r) => (
                <TransactionItem
                  key={r.id}
                  row={r}
                  onEdit={setEditing}
                  onDelete={requestDelete}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(r.id)}
                  onSelectToggle={toggleSelected}
                  onLongPress={enterSelection}
                />
              ))}
            </div>
          </section>
        ))
      )}

      <div ref={sentinelRef} className="flex justify-center py-4">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : cursor ? (
          <Button variant="ghost" size="sm" onClick={() => void loadMore()}>
            Load more
          </Button>
        ) : rows.length > 0 ? (
          <p className="text-xs text-muted-foreground">You&apos;re all caught up ✓</p>
        ) : null}
      </div>

      {/* sticky bulk-action bar — sits above the mobile bottom nav */}
      {selectionMode && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex w-[calc(100%-2rem)] max-w-md items-center gap-2 rounded-full border bg-background/95 p-2 shadow-lg backdrop-blur md:bottom-4">
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-full" onClick={exitSelection} aria-label="Cancel selection">
            <X className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium tabular-nums">{selectedIds.size} selected</span>
          <button
            type="button"
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={toggleSelectAll}
          >
            {allSelected ? "Clear" : "All"}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 gap-1 rounded-full"
              disabled={selectedIds.size === 0}
              onClick={requestBulkDelete}
            >
              <Trash2 className="h-4 w-4 text-destructive" /> Delete
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9 gap-1 rounded-full"
              disabled={selectedIds.size === 0}
              onClick={() => setPickerOpen(true)}
            >
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
      />

      <TransactionEditDialog
        row={editing}
        members={members}
        categories={categories}
        open={editing !== null}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        onRequestDelete={(row) => {
          setEditing(null);
          requestDelete(row);
        }}
      />
    </div>
  );
}
