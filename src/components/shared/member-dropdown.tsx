"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MemberOption } from "@/components/quick-add/types";

/**
 * §3.7 — one member dropdown for the whole app. The same chip used to live
 * three times: the header switcher (cookie-wide), Quick Add's and the edit
 * dialog's (form-local). All three render through this; they differ only in
 * label and what a selection does.
 */
export function MemberDropdown({
  members,
  activeMemberId,
  onSelect,
  label,
  triggerClassName,
}: {
  members: MemberOption[];
  activeMemberId: string;
  onSelect: (memberId: string) => void;
  /** The dropdown's heading — context explains what selecting changes. */
  label: string;
  triggerClassName?: string;
}) {
  const active = members.find((m) => m.id === activeMemberId);
  if (!active) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={triggerClassName ?? "gap-1 rounded-full bg-muted px-2.5 text-xs text-muted-foreground hover:bg-muted"}>
          <span>{active.emoji}</span>
          {active.name}
          <ChevronsUpDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {members.map((m) => (
          <DropdownMenuItem key={m.id} onSelect={() => onSelect(m.id)} className="gap-2">
            <span className="text-base">{m.emoji}</span>
            <span className="flex-1">{m.name}</span>
            {m.id === active.id && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
