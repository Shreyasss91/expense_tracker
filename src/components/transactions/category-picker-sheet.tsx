"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { suggestCategories } from "@/lib/category-suggestions";
import { useIsDesktop } from "@/lib/use-media-query";
import type { TransactionListRow } from "@/lib/query";
import type { CategoryOption } from "@/components/quick-add/types";
import { CategoryGrid } from "./transaction-fields";

/**
 * Amendment 20 — pick one category for a set of transactions (bulk assign,
 * also usable for a single row). Two-level taxonomy: note-based suggestions
 * surface as one-tap chips on top ("Ordered by matches with these
 * transactions' notes"), the full tree renders as accordion groups below.
 * The "None" tile clears the category — uncategorized is a valid destination,
 * not an error.
 */
export function CategoryPickerSheet({
  open,
  onOpenChange,
  categories,
  rows,
  onPick,
  recentCategoryIds = [],
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  categories: CategoryOption[];
  /** The transactions being categorized — drives the note-based suggestion ordering. */
  rows: TransactionListRow[];
  onPick: (categoryId: string | null) => void;
  /** Household's most-used categories (server-derived) for one-tap picks. */
  recentCategoryIds?: string[];
}) {
  const suggestedIds = useMemo(() => {
    const notes = rows.map((r) => r.note ?? "").filter((n) => n.trim().length > 0);
    if (notes.length === 0) return [];
    const scores = new Map<string, number>();
    for (const note of notes) {
      suggestCategories(note, categories).forEach((c, rank) => {
        scores.set(c.id, (scores.get(c.id) ?? 0) + (10 - rank));
      });
    }
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
  }, [rows, categories]);

  const suggested = suggestedIds.length > 0;
  const isDesktop = useIsDesktop();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        aria-labelledby="cp-sheet-title"
        className={
          isDesktop
            ? "flex h-full w-full max-w-sm flex-col rounded-l-2xl px-4 py-4 sm:px-6"
            : "mx-auto flex max-h-[80dvh] max-w-2xl flex-col rounded-t-2xl px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6"
        }
        showCloseButton={false}
      >
        {/* §3.4 — name the dialog for screen readers (visually hidden). */}
        <h2 className="sr-only" id="cp-sheet-title">Assign category</h2>
        {!isDesktop && <div className="mx-auto mb-1 h-1.5 w-10 rounded-full bg-muted" />}
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Assign category</p>
            <p className="text-xs text-muted-foreground">
              {rows.length > 0 ? `${rows.length} transaction${rows.length === 1 ? "" : "s"} selected` : "Pick a category"}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          <CategoryGrid
            categories={categories}
            selectedId=""
            onSelect={(id) => onPick(id === "" ? null : id)}
            hint={
              suggested
                ? "Chips match these transactions' notes — None leaves them uncategorized"
                : "Tap a group to open it, then a category — None leaves them uncategorized"
            }
            allowClear
            suggestedCategoryIds={suggestedIds}
            recentCategoryIds={recentCategoryIds}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
