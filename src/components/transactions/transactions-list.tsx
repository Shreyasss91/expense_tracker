"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getTransactionsPage, deleteTransaction } from "@/actions/transactions";
import { LEDGER_REFRESH_EVENT } from "@/lib/events";
import { dateGroupLabel } from "@/lib/dates";
import type { Cursor, TransactionListFilters, TransactionListRow } from "@/lib/query";
import type { CategoryOption, MemberOption } from "@/components/quick-add/types";
import { TransactionItem } from "./transaction-item";
import { TransactionEditDialog } from "./transaction-edit-dialog";
import { Button } from "@/components/ui/button";

const UNDO_WINDOW_MS = 5000; // §6.4.1 ~5 seconds

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

  // React to mutations made elsewhere (Quick Add, edit dialog, settings)
  useEffect(() => {
    const onRefresh = () => void refreshFirstPage();
    window.addEventListener(LEDGER_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(LEDGER_REFRESH_EVENT, onRefresh);
  }, [refreshFirstPage]);

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
                <TransactionItem key={r.id} row={r} onEdit={setEditing} onDelete={requestDelete} />
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
