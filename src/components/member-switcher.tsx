"use client";

import { useRouter } from "next/navigation";
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
import { updateActiveMember } from "@/actions/member";
import type { MemberOption } from "@/components/quick-add/types";

export function MemberSwitcher({
  members,
  activeMemberId,
}: {
  members: MemberOption[];
  activeMemberId: string;
}) {
  const router = useRouter();
  const active = members.find((m) => m.id === activeMemberId) ?? members[0];

  async function select(memberId: string) {
    await updateActiveMember(memberId);
    router.refresh();
  }

  if (!active) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-1.5 px-2 sm:px-3">
          <span className="text-lg leading-none">{active.emoji}</span>
          <span className="hidden font-medium sm:inline">{active.name}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Who&apos;s using the app?</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {members.map((m) => (
          <DropdownMenuItem key={m.id} onSelect={() => select(m.id)} className="gap-2">
            <span className="text-base">{m.emoji}</span>
            <span className="flex-1">{m.name}</span>
            {m.id === active.id && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
