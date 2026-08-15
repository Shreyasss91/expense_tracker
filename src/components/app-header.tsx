"use client";

import Link from "next/link";
import { Settings, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MemberSwitcher } from "@/components/member-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { useQuickAdd } from "@/components/quick-add/quick-add-context";
import type { MemberOption } from "@/components/quick-add/types";

export function AppHeader({
  members,
  activeMemberId,
}: {
  members: MemberOption[];
  activeMemberId: string;
}) {
  const { open } = useQuickAdd();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-1 px-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-xl">📒</span>
          <span className="hidden font-semibold tracking-tight min-[400px]:inline">Family Ledger</span>
        </Link>
        <div className="ml-auto flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="hidden h-9 w-9 sm:inline-flex" onClick={open} aria-label="Quick add">
            <Plus className="h-5 w-5" />
          </Button>
          <ThemeToggle />
          <MemberSwitcher members={members} activeMemberId={activeMemberId} />
          <Button variant="ghost" size="icon" className="h-9 w-9" asChild aria-label="Settings">
            <Link href="/settings">
              <Settings className="h-5 w-5" />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
