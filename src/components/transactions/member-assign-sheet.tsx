"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useIsDesktop } from "@/lib/use-media-query";
import { plural } from "@/lib/copy";
import type { MemberOption } from "@/components/quick-add/types";
import { MemberAssignmentPicker } from "./member-assignment";

/**
 * §2.2 — apply one "who is this for?" assignment to a whole selection at once.
 * Mirrors CategoryPickerSheet's shape: a scratch draft lives here, and only
 * Apply commits it (so toggling members never fires a server round trip).
 * An empty draft is a valid choice — it clears the assignment.
 */
export function MemberAssignSheet({
  open,
  onOpenChange,
  members,
  selectedCount,
  onApply,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  members: MemberOption[];
  /** How many ledger rows the assignment will land on. */
  selectedCount: number;
  /** Commit the draft; [] clears the assignment. */
  onApply: (memberIds: string[]) => void;
}) {
  const [draft, setDraft] = useState<string[]>([]);
  const isDesktop = useIsDesktop();

  // reset the draft each time the sheet opens so a previous pick never leaks
  // into a new selection
  useEffect(() => {
    if (open) setDraft([]);
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        aria-labelledby="ma-sheet-title"
        className={
          isDesktop
            ? "flex h-full w-full max-w-sm flex-col rounded-l-2xl px-4 py-4 sm:px-6"
            : "mx-auto flex max-h-[80dvh] max-w-2xl flex-col rounded-t-2xl px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6"
        }
        showCloseButton={false}
      >
        <h2 className="sr-only" id="ma-sheet-title">
          Assign to members
        </h2>
        {!isDesktop && <div className="mx-auto mb-1 h-1.5 w-10 rounded-full bg-muted" />}
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Who are these for?</p>
            <p className="text-xs text-muted-foreground">
              {selectedCount > 0 ? `${plural(selectedCount, "transaction")} selected` : "Nothing selected"}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          <MemberAssignmentPicker memberIds={draft} members={members} onChange={setDraft} />
        </div>
        <Button type="button" className="mt-3 w-full rounded-full" onClick={() => onApply(draft)}>
          {draft.length === 0 ? "Clear assignment" : `Assign to ${plural(draft.length, "member")}`}
        </Button>
      </SheetContent>
    </Sheet>
  );
}
