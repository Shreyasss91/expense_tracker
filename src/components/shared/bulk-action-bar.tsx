"use client";

import { ListChecks, Tag, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * §3.7 — the sticky bulk-action bar, shared verbatim by the ledger list and
 * the review queue (it was near-duplicated in both). Fixed above the mobile
 * bottom nav via the --bottom-nav-h token (§3.5).
 */
export function BulkActionBar({
  selectedCount,
  onCancel,
  onDelete,
  onAssign,
  onSelectAll,
  allSelected,
}: {
  selectedCount: number;
  onCancel: () => void;
  onDelete: () => void;
  onAssign: () => void;
  onSelectAll?: () => void;
  allSelected?: boolean;
}) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(var(--bottom-nav-h)+0.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex w-[calc(100%-2rem)] max-w-md items-center gap-2 rounded-full border bg-background/95 p-2 shadow-lg backdrop-blur md:bottom-4">
      <Button type="button" variant="ghost" size="icon" className="shrink-0 rounded-full" onClick={onCancel} aria-label="Cancel selection">
        <X className="h-4 w-4" />
      </Button>
      <span className="text-sm font-medium tabular-nums">{selectedCount} selected</span>
      {onSelectAll && (
        <button
          type="button"
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={onSelectAll}
        >
          {allSelected ? "Clear" : "All"}
        </button>
      )}
      <div className="ml-auto flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1 rounded-full"
          disabled={selectedCount === 0}
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4 text-destructive" /> Delete
        </Button>
        <Button
          type="button"
          size="sm"
          className="gap-1 rounded-full"
          disabled={selectedCount === 0}
          onClick={onAssign}
        >
          <Tag className="h-4 w-4" /> Assign
        </Button>
      </div>
    </div>
  );
}

/**
 * §3.7 — the collapsed-state "Select" affordance (desktop entry into
 * multi-select; mobile users long-press). Shared by both list surfaces.
 */
export function SelectModeButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="gap-1 rounded-full text-xs text-muted-foreground"
      onClick={onClick}
    >
      <ListChecks className="h-3.5 w-3.5" /> Select
    </Button>
  );
}
