"use client";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { MemberOption } from "@/components/quick-add/types";
import { cn } from "@/lib/utils";

/**
 * §2.2 — shared-ownership control. A single switch marks an expense as shared
 * across the household; when on, the member chips let you pick who splits it.
 * None selected = split among everyone. Toggling a chip edits `splitWith`
 * explicitly (so "all" is just the empty set, never stored as every id).
 */
export function SharedExpenseToggle({
  shared,
  splitWith,
  members,
  onChange,
  disabled,
}: {
  shared: boolean;
  splitWith: string[];
  members: MemberOption[];
  onChange: (next: { shared: boolean; splitWith: string[] }) => void;
  disabled?: boolean;
}) {
  // The effective set: explicit splitWith when present, else everyone.
  const effective = splitWith.length > 0 ? splitWith : members.map((m) => m.id);

  function toggleMember(id: string) {
    const next = effective.includes(id) ? effective.filter((x) => x !== id) : [...effective, id];
    // Canonicalise "everyone" back to the empty set.
    const allIds = members.map((m) => m.id).sort();
    const nextSorted = [...next].sort();
    const isAll = nextSorted.length === allIds.length && allIds.every((v, i) => v === nextSorted[i]);
    onChange({ shared: true, splitWith: isAll ? [] : next });
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor="shared-toggle" className="text-xs text-muted-foreground">
          Shared expense
        </Label>
        <Switch
          id="shared-toggle"
          checked={shared}
          disabled={disabled}
          onCheckedChange={(v) => onChange({ shared: v, splitWith: v ? splitWith : [] })}
        />
      </div>
      {shared && (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => {
              const on = effective.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleMember(m.id)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                    on
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted-foreground/10",
                  )}
                >
                  {m.emoji} {m.name}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Split evenly among the highlighted members. None highlighted = everyone.
          </p>
        </div>
      )}
    </div>
  );
}
