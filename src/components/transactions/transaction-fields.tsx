"use client";

import { useEffect, useMemo, useState } from "react";
import { format, parse, subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { Check, ChevronDown, ChevronRight, Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { APP_TIMEZONE, TRANSACTION_TAG_LABELS, TRANSACTION_TAGS } from "@/lib/constants";
import type { CategoryOption } from "@/components/quick-add/types";
import { cn } from "@/lib/utils";

export type TransactionTag = (typeof TRANSACTION_TAGS)[number];

/**
 * Sanitize a raw amount input into a value that always fits NUMERIC(12,2):
 * digits plus at most one decimal separator, at most 2 decimal digits, and at
 * most 10 integer digits (Amendment 10 §2).
 */
export function sanitizeAmountInput(raw: string): string {
  let v = raw.replace(/[^0-9.]/g, "");
  const firstDot = v.indexOf(".");
  if (firstDot !== -1) {
    v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, "");
  }
  const [intPart, decPart] = v.split(".");
  const trimmedInt = intPart.slice(0, 10);
  return decPart !== undefined ? `${trimmedInt}.${decPart.slice(0, 2)}` : trimmedInt;
}

/** Inline "add a new category" form state, rendered as the last tile in the grid. */
export interface AddCategoryForm {
  emoji: string;
  name: string;
  saving: boolean;
  error?: string | null;
  onEmojiChange: (v: string) => void;
  onNameChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

/**
 * Amount input — no label, ₹ prefix rendered inside the field, sized to sit
 * flush against the Tag cluster in the single-row Amount+Tag layout
 * (Amendment 10 §2). Sanitizes on change so the value always fits NUMERIC(12,2).
 */
export function AmountField({
  id,
  value,
  onChange,
  autoFocus,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  return (
    <div className="relative h-14 min-w-[110px] flex-1">
      <span
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-semibold text-muted-foreground"
      >
        ₹
      </span>
      <Input
        id={id}
        inputMode="decimal"
        placeholder="0.00"
        aria-label="Amount"
        aria-invalid={invalid || undefined}
        value={value}
        onChange={(e) => onChange(sanitizeAmountInput(e.target.value))}
        className="h-14 pl-8 text-lg font-semibold tabular-nums"
        autoFocus={autoFocus}
      />
    </div>
  );
}

/**
 * Date/Time row. In the collapsible variant (Quick Add) the defaults are shown
 * as a compact summary — "Today · 14:32" with a pencil — and the pickers appear
 * only after tapping it; the edit dialog renders the pickers directly.
 */
export function DateTimeField({
  date,
  time,
  onDateChange,
  onTimeChange,
  dateId,
  timeId,
  collapsible = false,
  showPicker = true,
  onTogglePicker,
}: {
  date: string;
  time: string;
  onDateChange: (v: string) => void;
  onTimeChange: (v: string) => void;
  dateId: string;
  timeId: string;
  collapsible?: boolean;
  showPicker?: boolean;
  onTogglePicker?: () => void;
}) {
  if (!collapsible || showPicker) {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={dateId} className="text-xs text-muted-foreground">Date</Label>
            <Input id={dateId} type="date" value={date} onChange={(e) => onDateChange(e.target.value)} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={timeId} className="text-xs text-muted-foreground">Time</Label>
            <Input id={timeId} type="time" value={time} onChange={(e) => onTimeChange(e.target.value)} className="h-10" />
          </div>
        </div>
        {collapsible && onTogglePicker && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
            onClick={onTogglePicker}
          >
            <Check className="h-3 w-3" /> Done
          </Button>
        )}
      </div>
    );
  }

  const now = new Date();
  const isToday = date === formatInTimeZone(now, APP_TIMEZONE, "yyyy-MM-dd");
  const isYesterday = date === formatInTimeZone(subDays(now, 1), APP_TIMEZONE, "yyyy-MM-dd");
  const dateLabel = isToday
    ? "Today"
    : isYesterday
      ? "Yesterday"
      : format(parse(date, "yyyy-MM-dd", new Date()), "d MMM yyyy");
  return (
    <button
      type="button"
      aria-label="Change date and time"
      onClick={onTogglePicker}
      className="flex w-full items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2.5 text-left"
    >
      <span className="text-xs text-muted-foreground">Date & time</span>
      <span className="flex items-center gap-1.5 text-sm font-medium tabular-nums">
        {dateLabel} · {time}
        <Pencil className="h-3 w-3 text-muted-foreground" />
      </span>
    </button>
  );
}

/**
 * Tag cluster (Amendment 10 §2) — a 2×2 grid at h-14. The selected tag fills
 * the left column as a display-only big button (col 1, row-span-2); the other
 * two tags sit stacked in the right column in canonical order
 * (lifestyle, recurring, one_time minus selected). Tapping an alternative
 * swaps it into the big slot — one tap to any tag, fully deterministic.
 */
export function TagSelector({
  value,
  onChange,
}: {
  value: TransactionTag;
  onChange: (t: TransactionTag) => void;
}) {
  const alternatives = TRANSACTION_TAGS.filter((t) => t !== value);
  return (
    <div
      role="radiogroup"
      aria-label="Tag"
      className="grid h-14 w-[52%] min-w-[150px] max-w-[240px] grid-cols-2 grid-rows-2 gap-1"
    >
      <button
        type="button"
        role="radio"
        aria-checked
        tabIndex={-1}
        className="row-span-2 flex items-center justify-center gap-1 truncate rounded-lg bg-primary px-1.5 text-xs font-medium text-primary-foreground sm:text-sm"
      >
        <Check className="h-3 w-3 shrink-0" />
        <span className="truncate">{TRANSACTION_TAG_LABELS[value]}</span>
      </button>
      {alternatives.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={false}
          onClick={() => onChange(t)}
          className="truncate rounded-md border bg-secondary px-1.5 text-[10px] font-medium text-muted-foreground active:scale-95 sm:text-[11px]"
        >
          {TRANSACTION_TAG_LABELS[t]}
        </button>
      ))}
    </div>
  );
}

/**
 * Amount + Tag row (Amendment 10 §2) — the Amount input and the Tag cluster
 * share a single `flex gap-2 h-14` row that never wraps, with the live ≈
 * preview rendered underneath. Shared by Quick Add and the edit dialog so
 * both forms have identical geometry.
 */
export function AmountTagRow({
  amountId,
  amount,
  onAmountChange,
  autoFocusAmount,
  amountInvalid,
  tag,
  onTagChange,
}: {
  amountId: string;
  amount: string;
  onAmountChange: (v: string) => void;
  autoFocusAmount?: boolean;
  amountInvalid?: boolean;
  tag: TransactionTag;
  onTagChange: (t: TransactionTag) => void;
}) {
  const paise = rupeesToPaise(amount || "0");
  return (
    <div>
      <div className="flex h-14 gap-2">
        <AmountField id={amountId} value={amount} onChange={onAmountChange} autoFocus={autoFocusAmount} invalid={amountInvalid} />
        <TagSelector value={tag} onChange={onTagChange} />
      </div>
      {paise > 0 ? (
        <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">≈ {formatINR(paise)}</p>
      ) : amountInvalid ? (
        <p className="mt-1.5 text-xs font-medium text-destructive">Enter a valid amount</p>
      ) : null}
    </div>
  );
}

/**
 * Category grid, two-level edition — the taxonomy renders as ACCORDION
 * sections (group headers expand/collapse; headers are never selectable —
 * only leaves are assignable), preceded by two one-tap chip rows:
 *   - "Suggested": caller-computed matches for the rows being categorized
 *   - "Recent": the household's most-used categories (server-derived)
 * The selected leaf's group starts expanded so an existing choice is always
 * visible. All per-leaf behaviour (budget hints, rename mode, add-new) is
 * unchanged — it just lives inside its group's section.
 */
export function CategoryGrid({
  categories,
  selectedId,
  onSelect,
  budgetRemaining,
  showBudgetHints = true,
  hint,
  // "None" tile (Amendment 20) — clears/un-assigns the category; used by the
  // edit dialog and bulk assign where a category is optional
  allowClear = false,
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
  // show-all link (optional — shown between hint and grid when suggestions are active)
  showAllLink,
  // add-new-category (optional — Quick Add only)
  onAddCategory,
  addForm,
  // one-tap chip rows (optional)
  suggestedCategoryIds = [],
  recentCategoryIds = [],
}: {
  categories: CategoryOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  budgetRemaining?: Map<string, number> | null;
  showBudgetHints?: boolean;
  hint?: string;
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
  showAllLink?: React.ReactNode;
  allowClear?: boolean;
  onAddCategory?: () => void;
  addForm?: AddCategoryForm;
  suggestedCategoryIds?: string[];
  recentCategoryIds?: string[];
}) {
  const canRename = Boolean(onToggleEditMode && onStartRename && onSaveRename && onCancelRename);
  const canAdd = Boolean(onAddCategory);

  // Tree derivation — groups are top-level rows (parentId null); everything
  // else is a leaf under exactly one of them.
  const { groups, byGroup } = useMemo(() => {
    const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
    const groupRows = sorted.filter((c) => c.parentId === null);
    const childMap = new Map<string, CategoryOption[]>();
    for (const c of sorted) {
      if (c.parentId === null) continue;
      const list = childMap.get(c.parentId) ?? [];
      list.push(c);
      childMap.set(c.parentId, list);
    }
    return { groups: groupRows, byGroup: childMap };
  }, [categories]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Keep the selected leaf visible: auto-expand its group whenever the
  // selection changes (opening a different row, picking a chip, etc.).
  useEffect(() => {
    if (!selectedId) return;
    const parent = categories.find((c) => c.id === selectedId)?.parentId;
    if (parent) setExpanded((prev) => (prev.has(parent) ? prev : new Set(prev).add(parent)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Chip rows resolve to leaf options only (groups are not assignable).
  const suggestedChips = useMemo(
    () => suggestedCategoryIds.map((id) => categories.find((c) => c.id === id)).filter((c): c is CategoryOption => !!c && c.parentId !== null),
    [suggestedCategoryIds, categories],
  );
  const recentChips = useMemo(
    () =>
      recentCategoryIds
        .filter((id) => !suggestedCategoryIds.includes(id))
        .map((id) => categories.find((c) => c.id === id))
        .filter((c): c is CategoryOption => !!c && c.parentId !== null),
    [recentCategoryIds, suggestedCategoryIds, categories],
  );

  /** One leaf chip — identical rendering wherever it appears. */
  function renderLeafChip(c: CategoryOption) {
    if (renamingId === c.id && canRename) {
      return (
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
      );
    }
    return (
      <button
        key={c.id}
        type="button"
        disabled={renaming}
        onClick={() => (editMode && canRename ? onStartRename?.(c) : onSelect(c.id))}
        className={cn(
          "relative inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium active:scale-95 disabled:opacity-60",
          !editMode && selectedId === c.id && "bg-primary text-primary-foreground",
        )}
        style={!editMode && selectedId === c.id ? undefined : { borderColor: c.color }}
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
        <span className="text-center text-xs font-medium leading-tight">{c.name}</span>
        {/* §6.7 — remaining budget hint, when this category has one for the month */}
        {showBudgetHints && budgetRemaining?.get(c.id) !== undefined && (
          <span
            className={`text-[10px] font-medium tabular-nums ${(budgetRemaining.get(c.id) ?? 0) < 0 ? "text-red-600" : "text-emerald-600"}`}
          >
            {(budgetRemaining.get(c.id) ?? 0) < 0
              ? `·${formatINR(-(budgetRemaining.get(c.id) ?? 0))} over`
              : `·${formatINR(budgetRemaining.get(c.id) ?? 0)} left`}
          </span>
        )}
      </button>
    );
  }

  function renderChipRow(label: string, chips: CategoryOption[]) {
    if (chips.length === 0 || editMode) return null;
    return (
      <div className="mb-2">
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className="flex flex-wrap gap-2">{chips.map(renderLeafChip)}</div>
      </div>
    );
  }

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
      <div className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <p>{hint ?? (editMode ? "Tap a category to rename" : "Tap a group to open it, then a category")}</p>
        {showAllLink && <span aria-hidden>·</span>}
        {showAllLink}
      </div>

      {/* None + suggested chips share the first row */}
      <div className="flex flex-wrap gap-2">
        {/* "None" tile — un-assign the category (Amendment 20) */}
        {allowClear && !editMode && (
          <button
            key="__none"
            type="button"
            disabled={renaming}
            onClick={() => onSelect("")}
            className={cn(
              "relative inline-flex items-center gap-1 rounded-full border border-dashed px-3 py-1.5 text-xs font-medium active:scale-95 disabled:opacity-60",
              selectedId === "" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            {selectedId === "" && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden>
                <Check className="h-3 w-3" />
              </span>
            )}
            None
          </button>
        )}
        {renderChipRowInline(suggestedChips)}
      </div>

      {renderChipRow("Recent", recentChips)}

      {/* accordion groups — headers toggle visibility, never select */}
      <div className="space-y-1">
        {groups.map((g) => {
          const children = byGroup.get(g.id) ?? [];
          const isOpen = expanded.has(g.id);
          return (
            <div key={g.id}>
              <button
                type="button"
                disabled={renaming}
                aria-expanded={isOpen}
                onClick={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(g.id)) next.delete(g.id);
                    else next.add(g.id);
                    return next;
                  })
                }
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-muted",
                  editMode && "cursor-default hover:bg-transparent",
                )}
              >
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="text-sm">{g.emoji}</span>
                <span className="truncate text-xs font-semibold">{g.name}</span>
                <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{children.length}</span>
              </button>
              {isOpen && <div className="flex flex-wrap gap-2 pb-1 pl-4 pt-0.5">{children.map(renderLeafChip)}</div>}
            </div>
          );
        })}
      </div>

      {/* add-new-category tile (Quick Add only, hidden while renaming) */}
      {!editMode && canAdd &&
        (addForm ? (
          <div key="__add" className="mt-2 flex flex-col gap-1 rounded-xl border border-dashed p-2">
            <div className="flex gap-1">
              <Input
                value={addForm.emoji}
                onChange={(e) => addForm.onEmojiChange(e.target.value)}
                className="h-8 w-10 shrink-0 px-1 text-center text-base"
                aria-label="Category emoji"
                maxLength={4}
              />
              <Input
                autoFocus
                value={addForm.name}
                onChange={(e) => addForm.onNameChange(e.target.value)}
                onKeyDown={(e) => {
                  // preventDefault stops Enter/Escape from also submitting the form
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addForm.onSave();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    addForm.onCancel();
                  }
                }}
                className="h-8 min-w-0 flex-1 text-center text-xs"
                aria-label="Category name"
                placeholder="New category"
                maxLength={50}
              />
            </div>
            {addForm.error && (
              <p className="text-center text-[10px] font-medium text-destructive">{addForm.error}</p>
            )}
            <div className="flex justify-center gap-1">
              <Button type="button" size="icon" className="h-6 w-6" disabled={addForm.saving} onClick={addForm.onSave} aria-label="Save new category">
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" size="icon" variant="ghost" className="h-6 w-6" disabled={addForm.saving} onClick={addForm.onCancel} aria-label="Cancel">
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <button
            key="__add"
            type="button"
            onClick={onAddCategory}
            className="mt-2 inline-flex items-center justify-center gap-1 rounded-full border border-dashed px-3 py-1.5 text-xs font-medium text-muted-foreground active:scale-95"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        ))}
    </div>
  );

  /** Suggested chips render inside the first row next to "None" (no label). */
  function renderChipRowInline(chips: CategoryOption[]) {
    if (chips.length === 0 || editMode) return null;
    return <>{chips.map((c) => renderLeafChip({ ...c }))}</>;
  }
}
