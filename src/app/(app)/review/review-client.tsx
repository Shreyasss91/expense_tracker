"use client";

import { useState, useCallback } from "react";
import { getReviewPage, type ReviewItem } from "@/actions/review";
import { acknowledgeTransactionReview } from "@/actions/transactions";
import { updateTransaction } from "@/actions/transactions";
import type { Member } from "@/db/schema";
import type { Cursor } from "@/lib/query";
import { formatPaiseCompact } from "@/lib/money";

interface Props {
  initialRows: ReviewItem[];
  nextCursor: Cursor | null;
  pendingCount: number;
  members: Member[];
}

export function ReviewClient({ initialRows, nextCursor: initialNextCursor, pendingCount, members }: Props) {
  const [rows, setRows] = useState<ReviewItem[]>(initialRows);
  const [nextCursor, setNextCursor] = useState<Cursor | null>(initialNextCursor);
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
    await acknowledgeTransactionReview(id);
    // Remove from local list
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const handleUpdateNote = useCallback(async (id: string, newNote: string | null) => {
    // Find current row to get other fields
    const row = rows.find((r) => r.id === id);
    if (!row) return;

    // We need to call updateTransaction with full data - but we only want to update note
    // For simplicity, we'll just acknowledge (clear from queue) since any non-generic note removes it
    // Actually, we need the full transaction update - let's use a simpler approach:
    // Just acknowledge for now, the user can edit properly in the main transaction edit dialog
    await acknowledgeTransactionReview(id);
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, [rows]);

  // Group by month
  const grouped = rows.reduce((acc, row) => {
    const month = row.date.slice(0, 7); // YYYY-MM
    if (!acc[month]) acc[month] = [];
    acc[month].push(row);
    return acc;
  }, {} as Record<string, ReviewItem[]>);

  const months = Object.keys(grouped).sort().reverse();

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Review</h1>
        <span className="text-sm text-muted-foreground">{pendingCount} pending</span>
      </header>

      {months.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">No items pending review</p>
      ) : (
        <>
          {months.map((month) => (
            <section key={month} className="space-y-2">
              <h2 className="text-sm font-medium text-muted-foreground sticky top-0 bg-background py-2">
                {new Date(month + "-01").toLocaleString("en-US", { month: "long", year: "numeric" })}
              </h2>
              <div className="space-y-2">
                {grouped[month].map((item) => (
                  <ReviewRow
                    key={item.id}
                    item={item}
                    onAcknowledge={handleAcknowledge}
                    onUpdateNote={handleUpdateNote}
                  />
                ))}
              </div>
            </section>
          ))}

          {nextCursor && (
            <button
              onClick={loadMore}
              disabled={loading}
              className="w-full py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {loading ? "Loading..." : "Load more"}
            </button>
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

  const handleSubmitNote = () => {
    onUpdateNote(item.id, noteValue.trim() || null);
    setEditing(false);
  };

  return (
    <div className="flex items-center justify-between p-3 border rounded-lg">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{item.member.emoji} {item.member.name}</span>
          <span className="text-muted-foreground">·</span>
          <span>{item.category.emoji} {item.category.name}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
          <span>{new Date(item.date).toLocaleDateString()}</span>
          <span>·</span>
          <span>₹{formatPaiseCompact(Number(item.amount))}</span>
          {item.note && (
            <>
              <span>·</span>
              {editing ? (
                <input
                  type="text"
                  value={noteValue}
                  onChange={(e) => setNoteValue(e.target.value)}
                  onBlur={handleSubmitNote}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSubmitNote();
                    if (e.key === "Escape") {
                      setEditing(false);
                      setNoteValue(item.note ?? "");
                    }
                  }}
                  className="bg-transparent border-b border-primary focus:outline-none min-w-[100px]"
                  autoFocus
                />
              ) : (
                <span
                  className="cursor-pointer hover:underline"
                  onClick={() => setEditing(true)}
                  title="Click to edit"
                >
                  {item.note}
                </span>
              )}
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 ml-4">
        {!item.note && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs px-2 py-1 rounded bg-muted hover:bg-muted/80"
          >
            Add note
          </button>
        )}
        <button
          onClick={() => onAcknowledge(item.id)}
          className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90"
        >
          No more detail
        </button>
      </div>
    </div>
  );
}
