"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, List, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useQuickAdd } from "@/components/quick-add/quick-add-context";
import { cn } from "@/lib/utils";
import { LEDGER_SELECTION_EVENT } from "@/lib/events";
import { usePendingReviewCount } from "@/components/use-pending-review-count";
import { useUncategorizedCount } from "@/components/use-uncategorized-count";

export function BottomNav() {
  const pathname = usePathname();
  const { open } = useQuickAdd();
  const pendingCount = usePendingReviewCount();
  const uncategorizedCount = useUncategorizedCount();
  // A sticky bulk bar (ledger/review selection) occupies the FAB's thumb
  // zone — hide the button while one is open, keeping the slot reserved.
  const [selectionActive, setSelectionActive] = useState(false);
  useEffect(() => {
    const onSelection = (e: Event) => setSelectionActive((e as CustomEvent<{ active: boolean }>).detail.active);
    window.addEventListener(LEDGER_SELECTION_EVENT, onSelection);
    return () => window.removeEventListener(LEDGER_SELECTION_EVENT, onSelection);
  }, []);

  const item = (
    href: string,
    label: string,
    icon: React.ReactNode,
    active: boolean,
    badge?: { count: number; tone: "destructive" | "amber" },
  ) => (
    <Link
      href={href}
      className={cn(
        "relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      {icon}
      {label}
      {/* Amendment 20 — review + uncategorized nudges ride the Ledger item */}
      {badge !== undefined && badge.count > 0 && (
        <span
          className={cn(
            "absolute right-1/2 top-1 flex h-4 min-w-4 translate-x-4 items-center justify-center rounded-full px-1 text-[9px] font-bold",
            badge.tone === "destructive"
              ? "bg-destructive text-destructive-foreground"
              : "bg-amber-500 text-white",
          )}
        >
          {badge.count > 9 ? "9+" : badge.count}
        </span>
      )}
    </Link>
  );

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur md:hidden">
      <div className="mx-auto flex w-full max-w-3xl items-center">
        {item("/", "Dashboard", <LayoutDashboard className="h-5 w-5" />, pathname === "/")}
        {/* Center FAB (§6.2.1) — hidden while a bulk-selection bar is open */}
        <div className="relative flex flex-1 justify-center">
          <button
            type="button"
            onClick={open}
            aria-label="Quick add"
            aria-hidden={selectionActive || undefined}
            tabIndex={selectionActive ? -1 : undefined}
            className={cn(
              "absolute -top-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-all active:scale-95",
              selectionActive && "pointer-events-none scale-0 opacity-0",
            )}
          >
            <Plus className="h-7 w-7" />
          </button>
        </div>
        {item("/transactions", "Ledger", <List className="h-5 w-5" />, pathname === "/transactions",
          pendingCount > 0
            ? { count: pendingCount, tone: "destructive" as const }
            : { count: uncategorizedCount, tone: "amber" as const },
        )}
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
