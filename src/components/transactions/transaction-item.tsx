"use client";

import { useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { displayTime } from "@/lib/dates";
import type { TransactionListRow } from "@/lib/query";
import { cn } from "@/lib/utils";

const DELETE_REVEAL = -80;

export function TransactionItem({
  row,
  onEdit,
  onDelete,
}: {
  row: TransactionListRow;
  onEdit: (row: TransactionListRow) => void;
  onDelete: (row: TransactionListRow) => void;
}) {
  const [dx, setDx] = useState(0);
  const [swiped, setSwiped] = useState(false);
  const startX = useRef<number | null>(null);
  const dragging = useRef(false);

  const paise = rupeesToPaise(row.amount);

  function onTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX;
    dragging.current = true;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (startX.current === null) return;
    const delta = e.touches[0].clientX - startX.current;
    // only horizontal swipes; clamp between full reveal and 0
    const next = swiped ? Math.max(DELETE_REVEAL, Math.min(0, delta + DELETE_REVEAL)) : Math.min(0, delta);
    setDx(next);
  }
  function onTouchEnd() {
    startX.current = null;
    dragging.current = false;
    if (dx < DELETE_REVEAL / 2) {
      setSwiped(true);
      setDx(DELETE_REVEAL);
    } else {
      setSwiped(false);
      setDx(0);
    }
  }

  function handleClick() {
    if (dragging.current || swiped) {
      // a tap while swiped closes the reveal instead of opening the editor
      if (swiped) {
        setSwiped(false);
        setDx(0);
      }
      return;
    }
    onEdit(row);
  }

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* delete affordance behind the row (§6.4.1) */}
      <button
        type="button"
        aria-label="Delete transaction"
        onClick={() => onDelete(row)}
        className="absolute inset-y-0 right-0 flex w-20 items-center justify-center bg-destructive text-white"
      >
        <Trash2 className="h-5 w-5" />
      </button>

      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className={cn(
          "relative flex w-full cursor-pointer items-center gap-3 rounded-xl bg-card px-3 py-3 text-left shadow-sm transition-transform duration-200",
          "active:bg-accent",
        )}
        style={{ transform: `translateX(${dx}px)` }}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl" style={{ background: `${row.category.color}1f` }}>
          {row.category.emoji}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {row.note || row.category.name}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{row.category.name}</span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{displayTime(row.time)}</span>
            {row.tag && (
              <>
                <span aria-hidden>·</span>
                <span className="capitalize">{row.tag}</span>
              </>
            )}
          </span>
        </span>
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs"
          title={row.member.name}
          style={{ background: `${row.member.color}22` }}
        >
          {row.member.emoji}
        </span>
        {/* visible edit affordance — tap the row also opens the editor */}
        <button
          type="button"
          aria-label="Edit transaction"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(row);
          }}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-red-600">
          −
          {formatINR(paise)}
        </span>
      </div>
    </div>
  );
}
