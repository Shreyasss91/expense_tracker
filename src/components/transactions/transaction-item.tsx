"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Paperclip, Trash2 } from "lucide-react";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { displayTime } from "@/lib/dates";
import type { TransactionListRow } from "@/lib/query";
import { cn } from "@/lib/utils";

const DELETE_REVEAL = -80;
const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 12;

/**
 * One ledger row. Amendment 20 adds two behaviours:
 *  - uncategorized rows render an explicit "Uncategorized" state (no fake
 *    category row anywhere);
 *  - a long-press enters multi-select mode (and selects this row); while the
 *    list is in selection mode a tap toggles the row's checkbox instead of
 *    opening the editor, and swipe-to-delete is suspended.
 */
export function TransactionItem({
  row,
  onEdit,
  onDelete,
  selectionMode = false,
  selected = false,
  onSelectToggle,
  onLongPress,
}: {
  row: TransactionListRow;
  onEdit: (row: TransactionListRow) => void;
  onDelete: (row: TransactionListRow) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onSelectToggle?: (row: TransactionListRow) => void;
  onLongPress?: (row: TransactionListRow) => void;
}) {
  const [dx, setDx] = useState(0);
  const [swiped, setSwiped] = useState(false);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const dragging = useRef(false);
  // §3.6 — live drag distance in a ref: the long-press guard below used to
  // close over `dx` state, so a 450ms-old timer read a stale value and a row
  // that had been swiped shut could still enter selection mode.
  const dxRef = useRef(0);
  const swipedRef = useRef(false);
  // §3.6 — rAF coalescing: touchmove fires far faster than the display
  // refresh; committing state per event re-rendered the row dozens of times
  // per gesture. The latest delta is stored in the ref and flushed once per
  // frame.
  const rafRef = useRef<number | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // swallow the synthetic click that follows a fired long-press, so entering
  // selection mode doesn't immediately toggle the row back off
  const longPressFired = useRef(false);

  const paise = rupeesToPaise(row.amount);
  const cat = row.category;

  function clearPressTimer() {
    if (pressTimer.current !== null) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  function flushDx() {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setDx(dxRef.current);
    });
  }

  // §3.6 — shared snap: touchend, touchcancel and close-on-click all land here.
  function snap(dxValue: number, swipedValue: boolean) {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    dxRef.current = dxValue;
    swipedRef.current = swipedValue;
    setDx(dxValue);
    setSwiped(swipedValue);
  }

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    clearPressTimer();
  }, []);

  function onTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    dragging.current = true;
    longPressFired.current = false;
    // long-press arms selection mode unless the finger moves (scroll/swipe).
    // §3.6 — reads dxRef/swipedRef (live values), never stale state.
    if (!selectionMode && onLongPress) {
      pressTimer.current = setTimeout(() => {
        pressTimer.current = null;
        if (!swipedRef.current && dxRef.current === 0) {
          dragging.current = false;
          longPressFired.current = true;
          onLongPress(row);
        }
      }, LONG_PRESS_MS);
    }
  }

  function onTouchMove(e: React.TouchEvent) {
    if (startX.current === null || selectionMode) return; // no swipe while selecting
    const t = e.touches[0];
    // any real movement cancels a pending long-press
    if (
      pressTimer.current !== null &&
      (Math.abs(t.clientX - startX.current) > MOVE_TOLERANCE_PX ||
        (startY.current !== null && Math.abs(t.clientY - startY.current) > MOVE_TOLERANCE_PX))
    ) {
      clearPressTimer();
    }
    const delta = t.clientX - startX.current;
    // only horizontal swipes; clamp between full reveal and 0
    const next = swipedRef.current ? Math.max(DELETE_REVEAL, Math.min(0, delta + DELETE_REVEAL)) : Math.min(0, delta);
    dxRef.current = next;
    flushDx(); // §3.6 — one state commit per frame, not per touchmove
  }

  function onTouchEnd() {
    clearPressTimer();
    startX.current = null;
    startY.current = null;
    dragging.current = false;
    if (dxRef.current < DELETE_REVEAL / 2) snap(DELETE_REVEAL, true);
    else snap(0, false);
  }

  // §3.6 — an interrupted touch (incoming call, notification shade, gesture
  // nav) used to leave the row stuck open because nothing handled touchcancel.
  function onTouchCancel() {
    clearPressTimer();
    startX.current = null;
    startY.current = null;
    dragging.current = false;
    snap(0, false);
  }

  function handleClick() {
    // the click trailing a long-press must not toggle the just-selected row
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    if (dragging.current || swipedRef.current) {
      // a tap while swiped closes the reveal instead of opening the editor
      if (swipedRef.current) snap(0, false);
      return;
    }
    if (selectionMode) {
      onSelectToggle?.(row);
      return;
    }
    onEdit(row);
  }

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* delete affordance behind the row (§6.4.1) — §3.4: only focusable
          once revealed by a swipe; keyboard users would otherwise tab onto an
          invisible destructive button behind every row. */}
      <button
        type="button"
        aria-label="Delete transaction"
        aria-hidden={!swiped}
        tabIndex={swiped ? 0 : -1}
        onClick={() => onDelete(row)}
        className="absolute inset-y-0 right-0 flex w-20 items-center justify-center bg-destructive text-white"
      >
        <Trash2 className="h-5 w-5" />
      </button>

      <div
        role="button"
        tabIndex={0}
        aria-pressed={selectionMode ? selected : undefined}
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
        onTouchCancel={onTouchCancel}
        className={cn(
          "relative flex w-full cursor-pointer items-center gap-3 rounded-xl bg-card px-3 py-3 text-left shadow-sm transition-transform duration-200",
          "active:bg-accent",
          selectionMode && selected && "bg-primary/5 ring-1 ring-primary",
        )}
        style={{ transform: `translateX(${dx}px)` }}
      >
        {selectionMode ? (
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors",
              selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40 bg-background",
            )}
            aria-hidden
          >
            {selected && <Check className="h-4 w-4" />}
          </span>
        ) : null}
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl"
          style={{ background: cat ? `${cat.color}1f` : "#9ca3af1f" }}
        >
          {cat ? cat.emoji : "?"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{row.note || cat?.name || "Uncategorized"}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {cat ? (
              <span className="truncate">{cat.name}</span>
            ) : (
              <span className="truncate font-medium text-amber-600 dark:text-amber-500">Uncategorized</span>
            )}
            <span aria-hidden>·</span>
            <span className="tabular-nums">{displayTime(row.time)}</span>
            {/* §2.9 — "there is a photo behind this number", at a glance */}
            {row.receiptCount > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-0.5" title={`${row.receiptCount} receipt${row.receiptCount === 1 ? "" : "s"}`}>
                  <Paperclip className="h-3 w-3" aria-hidden />
                  <span className="sr-only">
                    {row.receiptCount} receipt{row.receiptCount === 1 ? "" : "s"} attached
                  </span>
                </span>
              </>
            )}
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
        {!selectionMode && (
          <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
        )}
        <span className="shrink-0 text-sm font-semibold tabular-nums text-red-600">
          −
          {formatINR(paise)}
        </span>
      </div>
    </div>
  );
}
