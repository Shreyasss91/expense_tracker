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
 * also usable for a single row). Categories are ordered by how well they match
 * the selected rows' notes (rank-weighted §6.2 suggestions summed across the
 * selection), so the right chip tends to sit first. The "None" tile clears the
 * category — uncategorized is a valid destination, not an error.
 */
export function CategoryPickerSheet({
  open,
  onOpenChange,
  categories,
  rows,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  categories: CategoryOption[];
  /** The transactions being categorized — drives the note-based suggestion ordering. */
  rows: TransactionListRow[];
  onPick: (categoryId: string | null) => void;
}) {
  const orderedCategories = useMemo(() => {
    const notes = rows.map((r) => r.note ?? "").filter((n) => n.trim().length > 0);
    if (notes.length === 0) return categories;
    const scores = new Map<string, number>();
    for (const note of notes) {
      suggestCategories(note, categories).forEach((c, rank) => {
        scores.set(c.id, (scores.get(c.id) ?? 0) + (10 - rank));
      });
    }
    if (scores.size === 0) return categories;
    return [...categories].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
  }, [rows, categories]);

  const suggested = orderedCategories !== categories;
  const isDesktop = useIsDesktop();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        className={
          isDesktop
            ? "flex h-full w-full max-w-sm flex-col rounded-l-2xl px-4 py-4 sm:px-6"
            : "mx-auto flex max-h-[80dvh] max-w-2xl flex-col rounded-t-2xl px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6"
        }
        showCloseButton={false}
      >
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
            categories={orderedCategories}
            selectedId=""
            onSelect={(id) => onPick(id === "" ? null : id)}
            hint={
              suggested
                ? "Ordered by matches with these transactions' notes — None leaves them uncategorized"
                : "Tap a category to assign it — None leaves them uncategorized"
            }
            allowClear
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
