"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { getReviewPage, updateReviewNote, type ReviewItem } from "@/actions/review";
import { acknowledgeTransactionReview } from "@/actions/transactions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dateGroupLabel } from "@/lib/dates";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { isGenericNote } from "@/lib/generic-notes";
import type { Cursor } from "@/lib/query";

interface Props {
  initialRows: ReviewItem[];
  nextCursor: Cursor | null;
  pendingCount: number;
}

export function ReviewClient({ initialRows, nextCursor: initialNextCursor, pendingCount: initialPendingCount }: Props) {
  const [rows, setRows] = useState<ReviewItem[]>(initialRows);
  const [nextCursor, setNextCursor] = useState<Cursor | null>(initialNextCursor);
  const [pendingCount, setPendingCount] = useState(initialPendingCount);
  const [loading, setLoading] = useState(false);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loading) return;
    setLoading(true);
    try {
      const data = await getReviewPage({ cursor: nextCursor });
      setRows((prev) => [...prev, ...data.rows]);
      setNextCursor(data.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [nextCursor, loading]);

  const handleAcknowledge = useCallback(async (id: string) => {
    const result = await acknowledgeTransactionReview(id);
    if (!result.ok) {
      toast.error(result.error ?? "Could not acknowledge transaction");
      return;
    }
    setRows((prev) => prev.filter((row) => row.id !== id));
    setPendingCount((count) => Math.max(0, count - 1));
  }, []);

  const handleUpdateNote = useCallback(async (id: string, newNote: string | null) => {
    const result = await updateReviewNote(id, newNote);
    if (!result.ok) {
      toast.error(result.error ?? "Could not update note");
      return;
    }
    const row = rows.find((item) => item.id === id);
    if (!row) return;
    const normalized = newNote?.trim() || null;
    const stillPending = isGenericNote(normalized) || normalized?.toLowerCase() === row.category.name.trim().toLowerCase();
    if (stillPending) {
      setRows((prev) => prev.map((item) => (item.id === id ? { ...item, note: normalized } : item)));
    } else {
      setRows((prev) => prev.filter((item) => item.id !== id));
      setPendingCount((count) => Math.max(0, count - 1));
    }
  }, [rows]);

  const grouped = rows.reduce((acc, row) => {
    const month = row.date.slice(0, 7);
    (acc[month] ??= []).push(row);
    return acc;
  }, {} as Record<string, ReviewItem[]>);
  const months = Object.keys(grouped).sort().reverse();

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Review</h1>
          <p className="text-xs text-muted-foreground">Month-end reconciliation for generic notes</p>
        </div>
        <span className="text-sm text-muted-foreground">{pendingCount} pending</span>
      </header>

      {months.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No items pending review</div>
      ) : (
        <>
          {months.map((month) => (
            <section key={month} className="space-y-2">
              <h2 className="sticky top-14 z-10 bg-background py-2 text-sm font-medium text-muted-foreground">{month}</h2>
              <div className="space-y-2">
                {grouped[month].map((item) => (
                  <ReviewRow key={item.id} item={item} onAcknowledge={handleAcknowledge} onUpdateNote={handleUpdateNote} />
                ))}
              </div>
            </section>
          ))}
          {nextCursor && (
            <Button type="button" variant="outline" className="w-full" onClick={() => void loadMore()} disabled={loading}>
              {loading ? "Loading…" : "Load more"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function ReviewRow({
  item,
  onAcknowledge,
  onUpdateNote,
}: {
  item: ReviewItem;
  onAcknowledge: (id: string) => void;
  onUpdateNote: (id: string, note: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [noteValue, setNoteValue] = useState(item.note ?? "");

  function saveNote() {
    onUpdateNote(item.id, noteValue.trim() || null);
    setEditing(false);
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{item.member.emoji} {item.member.name}</span>
            <span className="text-muted-foreground">·</span>
            <span>{item.category.name}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{dateGroupLabel(item.date)}</span>
            <span>·</span>
            <span className="tabular-nums">{formatINR(rupeesToPaise(item.amount))}</span>
            <span>·</span>
            {editing ? (
              <Input
                value={noteValue}
                maxLength={140}
                autoFocus
                onChange={(event) => setNoteValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveNote();
                  if (event.key === "Escape") setEditing(false);
                }}
                onBlur={saveNote}
                className="h-7 min-w-32 flex-1 text-xs"
                aria-label="Review note"
              />
            ) : (
              <button type="button" className="truncate text-left hover:text-foreground hover:underline" onClick={() => setEditing(true)}>
                {item.note || "Add a useful note"}
              </button>
            )}
          </div>
        </div>
        <Button type="button" size="sm" onClick={() => onAcknowledge(item.id)}>No more detail</Button>
      </div>
    </div>
  );
}
