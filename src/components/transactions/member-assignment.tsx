"use client";

import { cn } from "@/lib/utils";
import type { MemberOption } from "@/components/quick-add/types";

/**
 * "Who is this expense for?" — a free-standing, optional multi-select.
 *
 * Distinct from the member the expense was *entered* by (the header/member
 * dropdown): an entry logged by one member can be for that member, a couple,
 * or the whole household, and is unassigned by default. The selected ids land
 * in `transactions.split_with`; an empty array means "not assigned".
 */
export function MemberAssignmentPicker({
  memberIds,
  members,
  onChange,
  disabled,
}: {
  /** Selected member ids — the members this expense is for. [] = not assigned. */
  memberIds: string[];
  members: MemberOption[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  function toggle(id: string) {
    onChange(memberIds.includes(id) ? memberIds.filter((x) => x !== id) : [...memberIds, id]);
  }

  const summary =
    memberIds.length === 0
      ? "Not assigned — tap who this expense is for."
      : memberIds.length === members.length
        ? "For everyone."
        : `For ${memberIds.length} member${memberIds.length === 1 ? "" : "s"}.`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Who is this expense for? (optional)</span>
        {memberIds.length > 0 && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange([])}
            className="text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
          >
            Clear
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {members.map((m) => {
          const on = memberIds.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => toggle(m.id)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                on
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted-foreground/10",
                disabled && "opacity-50",
              )}
            >
              {m.emoji} {m.name}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground">{summary}</p>
    </div>
  );
}
