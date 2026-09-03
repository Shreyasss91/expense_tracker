"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { X } from "lucide-react";
import { getTransactionsPage, deleteTransaction, deleteTransactions, assignCategory } from "@/actions/transactions";
import { LEDGER_MUTATION_EVENT, type LedgerMutation } from "@/lib/events";
import { emitLedgerMutation, emitSelectionMode } from "@/lib/events";
import { useQuickAdd } from "@/components/quick-add/quick-add-context";
import { dateGroupLabel } from "@/lib/dates";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { emptyStateCopy, plural } from "@/lib/copy";
import { useEscToExit } from "@/lib/use-esc-exit";
import { BulkActionBar, SelectModeButton } from "@/components/shared/bulk-action-bar";
import type { Cursor, TransactionListFilters, TransactionListRow } from "@/lib/query";
import type { CategoryOption, MemberOption } from "@/components/quick-add/types";
import { TransactionItem } from "./transaction-item";
import { Button } from "@/components/ui/button";

/* §3.8 — the heavy editing stack (edit dialog: split mode, receipts, budget
 * hints; category picker: suggestion engine) used to ride along with every
 * ledger list — including the dashboard's first paint. Both are client-only
 * overlays that do nothing until opened, so they load on FIRST OPEN via
 * next/dynamic instead of on first paint. The rows themselves stay eager —
 * they are the content. */
const TransactionEditDialog = dynamic(
  () => import("./transaction-edit-dialog").then((m) => m.TransactionEditDialog),
  { ssr: false },
);
const CategoryPickerSheet = dynamic(
  () => import("./category-picker-sheet").then((m) => m.CategoryPickerSheet),
  { ssr: false },
);

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
 * they actually satisfy the active filters (member/category/group/tag/month/
 * search). Group filters resolve against the client's category list — the
 * same leaves expandGroupFilter() fetches server-side.
 */
function matchesFilters(
  row: TransactionListRow,
  f: TransactionListFilters,
  categories: CategoryOption[] = [],
): boolean {
  if (f.memberId && row.memberId !== f.memberId) return false;
  if (f.categoryId) {
    if (row.categoryId !== f.categoryId) return false;
  } else if (f.groupId) {
    const childIds = new Set(categories.filter((c) => c.parentId === f.groupId).map((c) => c.id));
    if (row.categoryId === null || !childIds.has(row.categoryId)) return false;
  } else if (f.uncategorized && row.categoryId !== null) return false;
  if (f.tag && row.tag !== f.tag) return false;
  if (f.month && !row.date.startsWith(f.month)) return false;
  if (f.from && row.date < f.from) return false;
  if (f.to && row.date > f.to) return false;
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
  enableSelection = true,
  recentCategoryIds = [],
}: {
  initialRows: TransactionListRow[];
  initialCursor: Cursor | null;
  filters: TransactionListFilters;
  members: MemberOption[];
  categories: CategoryOption[];
  /** UX pass — false hides all bulk tooling (dashboard's preview panel). */
  enableSelection?: boolean;
  /** Household's most-used categories (server-derived) for one-tap picks. */
  recentCategoryIds?: string[];
}) {
  const [rows, setRows] = useState<TransactionListRow[]>(initialRows);
  const [cursor, setCursor] = useState<Cursor | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<TransactionListRow | null>(null);
  // Amendment 20 — multi-select for bulk categorize / bulk delete
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  // UX pass — the empty state's CTA opens the same Quick Add sheet as the FAB
  const { open: openQuickAdd } = useQuickAdd();

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
          if (!matchesFilters(m.row, filters, categories)) return;
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
              if (!matchesFilters(m.row, filters, categories)) return prev;
              return [...prev, m.row].sort(compareRows);
            }
            if (!matchesFilters(m.row, filters, categories)) return prev.filter((r) => r.id !== m.id);
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
  }, [filters, refreshFirstPage, categories]);

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

    // §3.3 — commit on EVERY close path. Sonner fires onAutoClose only when
    // the timer lapses; a swipe or X dismiss skips it, so a pending delete
    // could sit in pendingRef until unmount and be silently lost if the app
    // dies in that window. The Undo handler deletes the pending entry before
    // the toast closes, so whichever callback fires after Undo finds nothing
    // to commit — the fired flag guards a double fire.
    const commit = () => {
      const p = pendingRef.current.get(row.id);
      if (p && !p.fired) {
        p.fired = true;
        void deleteTransaction(row.id);
      }
    };

    // 2. toast with Undo + ~5s window (§6.4.1)
    toast("Transaction deleted", {
      duration: UNDO_WINDOW_MS,
      action: {
        label: "Undo",
        onClick: () => {
          // 3. Undo: cancel the pending delete; no database write ever occurred (§6.4.1)
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
      // 4. timer lapses OR user dismisses → hard delete fires (§3.3)
      onAutoClose: commit,
      onDismiss: commit,
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

  // Broadcast so the bottom nav can tuck the + FAB away while the bulk bar
  // occupies its thumb zone.
  useEffect(() => {
    emitSelectionMode(selectionMode);
    return () => emitSelectionMode(false);
  }, [selectionMode]);

  // §3.7 — shared Esc-to-exit effect (was duplicated in the review queue)
  useEscToExit(selectionMode, exitSelection);

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
        categoryId ? `Categorized ${plural(res.updated, "transaction")}` : `Removed category from ${plural(res.updated, "transaction")}`,
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

    // §3.3 — commit on every close path (timer, swipe or X); see requestDelete.
    // The Undo handler deletes pending entries first, so a commit after Undo
    // is a no-op, and the fired flag prevents a double fire.
    const commit = () => {
      const ids: string[] = [];
      for (const s of snapshot) {
        const p = pendingRef.current.get(s.row.id);
        if (p && !p.fired) {
          p.fired = true;
          ids.push(s.row.id);
        }
      }
      if (ids.length > 0) void deleteTransactions(ids);
    };

    // 2/3/4. one undoable toast drives the batch (same window as single delete)
    toast(`${plural(snapshot.length, "transaction")} deleted`, {
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
      onAutoClose: commit,
      onDismiss: commit,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────

  // Layout pass — each day group carries its total so the header reads
  // "Yesterday …… ₹1,240" while scanning; the sum covers exactly the rows in
  // the group (which is the loaded pages, consistent with the list itself).
  const groups = useMemo(() => {
    const map = new Map<string, { items: TransactionListRow[]; totalPaise: number }>();
    for (const r of rows) {
      const label = dateGroupLabel(r.date);
      const entry = map.get(label) ?? { items: [], totalPaise: 0 };
      entry.items.push(r);
      entry.totalPaise += rupeesToPaise(r.amount);
      map.set(label, entry);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <div className="space-y-4">
      {/* selection entry point / status — desktop users have no long-press */}
      {enableSelection && (
        <div className="flex items-center justify-end">
          {!selectionMode ? (
            rows.length > 0 && <SelectModeButton onClick={() => enterSelection(rows[0])} />
          ) : (
            <Button type="button" variant="ghost" size="sm" className="gap-1 rounded-full text-xs text-muted-foreground" onClick={exitSelection}>
              <X className="h-3.5 w-3.5" /> Cancel selection
            </Button>
          )}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <span className="text-3xl">🗒️</span>
          {/* §3.7 — standardised empty-state copy (shared with the review queue) */}
          {(() => {
            const copy = emptyStateCopy(
              Boolean(filters.memberId || filters.tag || filters.categoryId || filters.uncategorized || filters.groupId || filters.search?.trim() || filters.month || filters.from || filters.to),
            );
            return (
              <>
                <p className="mt-2 text-sm font-medium">{copy.title}</p>
                <p className="text-xs text-muted-foreground">{copy.hint}</p>
              </>
            );
          })()}
          <Button type="button" size="sm" className="mt-4 rounded-full" onClick={openQuickAdd}>
            Add an expense
          </Button>
        </div>
      ) : (
        groups.map(([label, { items, totalPaise }]) => (
          <section key={label}>
            <div className="mb-2 flex items-baseline justify-between px-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">{formatINR(totalPaise)}</span>
            </div>
            <div className="space-y-2">
              {items.map((r) => (
                <TransactionItem
                  key={r.id}
                  row={r}
                  onEdit={setEditing}
                  onDelete={requestDelete}
                  selectionMode={enableSelection && selectionMode}
                  selected={selectedIds.has(r.id)}
                  onSelectToggle={toggleSelected}
                  onLongPress={enableSelection ? enterSelection : undefined}
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

      {/* sticky bulk-action bar — shared component (§3.7) */}
      {selectionMode && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          onCancel={exitSelection}
          onDelete={requestBulkDelete}
          onAssign={() => setPickerOpen(true)}
          onSelectAll={toggleSelectAll}
          allSelected={allSelected}
        />
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
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        onRequestDelete={(row) => {
          setEditing(null);
          requestDelete(row);
        }}
      />
    </div>
  );
}
