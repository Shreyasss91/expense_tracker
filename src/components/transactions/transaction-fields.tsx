"use client";

import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { TRANSACTION_TAG_LABELS, TRANSACTION_TAGS } from "@/lib/constants";
import type { CategoryOption } from "@/components/quick-add/types";
import { cn } from "@/lib/utils";

export type TransactionTag = (typeof TRANSACTION_TAGS)[number];

/**
 * Amount field — large input with a live ₹ preview. Shared by the Quick Add
 * sheet and the edit-transaction dialog so both forms feel identical (§6.2).
 */
export function AmountField({
  id,
  value,
  onChange,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  const paise = rupeesToPaise(value);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">Amount (₹)</Label>
      <Input
        id={id}
        inputMode="decimal"
        placeholder="0.00"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 text-2xl font-semibold tabular-nums"
        autoFocus={autoFocus}
      />
      {paise > 0 && <p className="text-xs tabular-nums text-muted-foreground">≈ {formatINR(paise)}</p>}
    </div>
  );
}

/** Tag selector — three chips with a check on the selected tag. */
export function TagSelector({
  value,
  onChange,
}: {
  value: TransactionTag;
  onChange: (t: TransactionTag) => void;
}) {
  return (
    <div>
      <Label className="mb-1.5 text-xs text-muted-foreground">Tag</Label>
      <div className="grid grid-cols-3 gap-2">
        {TRANSACTION_TAGS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            className={cn(
              "flex h-9 items-center justify-center gap-1 rounded-lg text-xs font-medium",
              value === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
            )}
          >
            {value === t && <Check className="h-3.5 w-3.5" />}
            {TRANSACTION_TAG_LABELS[t]}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Category grid — tap a tile to select it (ring + check badge). Optionally shows
 * per-category remaining-budget hints (§6.7) and, when the rename callbacks are
 * provided, the inline rename/edit mode used by Quick Add. The edit dialog uses
 * the grid without the rename mode.
 */
export function CategoryGrid({
  categories,
  selectedId,
  onSelect,
  budgetRemaining,
  showBudgetHints = true,
  // rename mode (optional — Quick Add only)
  editMode = false,
  onToggleEditMode,
  onExitEditMode,
  renamingId = null,
  renameValue = "",
  renameEmoji = "",
  renaming = false,
  onRenameValueChange,
  onRenameEmojiChange,
  onStartRename,
  onSaveRename,
  onCancelRename,
}: {
  categories: CategoryOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  budgetRemaining?: Map<string, number> | null;
  showBudgetHints?: boolean;
  editMode?: boolean;
  onToggleEditMode?: () => void;
  onExitEditMode?: () => void;
  renamingId?: string | null;
  renameValue?: string;
  renameEmoji?: string;
  renaming?: boolean;
  onRenameValueChange?: (v: string) => void;
  onRenameEmojiChange?: (v: string) => void;
  onStartRename?: (c: CategoryOption) => void;
  onSaveRename?: (c: CategoryOption) => void;
  onCancelRename?: () => void;
}) {
  const canRename = Boolean(onToggleEditMode && onStartRename && onSaveRename && onCancelRename);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">Category</Label>
        {canRename &&
          (editMode ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
              onClick={onExitEditMode}
            >
              <Check className="h-3 w-3" /> Done
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
              onClick={onToggleEditMode}
            >
              <Pencil className="h-3 w-3" /> Rename categories
            </Button>
          ))}
      </div>
      <p className="mb-2 text-[11px] text-muted-foreground">
        {editMode ? "Tap a category to rename" : "Tap a category to select it"}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {categories.map((c) =>
          renamingId === c.id && canRename ? (
            <div key={c.id} className="flex flex-col gap-1 rounded-xl border p-2" style={{ borderColor: c.color }}>
              <div className="flex gap-1">
                <Input
                  value={renameEmoji}
                  onChange={(e) => onRenameEmojiChange?.(e.target.value)}
                  className="h-8 w-10 shrink-0 px-1 text-center text-base"
                  aria-label="Category emoji"
                  maxLength={4}
                />
                <Input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => onRenameValueChange?.(e.target.value)}
                  onKeyDown={(e) => {
                    // preventDefault stops Enter/Escape from also submitting the form
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onSaveRename?.(c);
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      onCancelRename?.();
                    }
                  }}
                  className="h-8 min-w-0 flex-1 text-center text-xs"
                  aria-label="Category name"
                  maxLength={50}
                />
              </div>
              <div className="flex justify-center gap-1">
                <Button type="button" size="icon" className="h-6 w-6" disabled={renaming} onClick={() => onSaveRename?.(c)} aria-label="Save name and emoji">
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" size="icon" variant="ghost" className="h-6 w-6" disabled={renaming} onClick={onCancelRename} aria-label="Cancel rename">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ) : (
            <button
              key={c.id}
              type="button"
              disabled={renaming}
              onClick={() => (editMode && canRename ? onStartRename?.(c) : onSelect(c.id))}
              className={cn(
                "relative flex flex-col items-center gap-1 rounded-xl border p-3 active:scale-95 disabled:opacity-60",
                !editMode && selectedId === c.id && "ring-2 ring-primary",
              )}
              style={{ borderColor: c.color }}
            >
              {!editMode && selectedId === c.id && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden>
                  <Check className="h-3 w-3" />
                </span>
              )}
              {editMode && canRename && (
                <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground" aria-hidden>
                  <Pencil className="h-2.5 w-2.5" />
                </span>
              )}
              <span className="text-2xl">{c.emoji}</span>
              <span className="text-center text-xs font-medium leading-tight">{c.name}</span>
              {/* §6.7 — remaining budget hint, when this category has one for the month */}
              {showBudgetHints && budgetRemaining?.get(c.id) !== undefined && (
                <span
                  className={`text-[10px] font-medium tabular-nums ${(budgetRemaining.get(c.id) ?? 0) < 0 ? "text-red-600" : "text-emerald-600"}`}
                >
                  {(budgetRemaining.get(c.id) ?? 0) < 0
                    ? `${formatINR(-(budgetRemaining.get(c.id) ?? 0))} over`
                    : `${formatINR(budgetRemaining.get(c.id) ?? 0)} left`}
                </span>
              )}
            </button>
          )
        )}
      </div>
    </div>
  );
}
