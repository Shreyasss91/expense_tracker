"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { QuickAddSheet } from "./quick-add-sheet";
import type { MemberOption, TemplateOption } from "./types";

interface QuickAddContextValue {
  open: () => void;
}

const QuickAddContext = createContext<QuickAddContextValue | null>(null);

export function QuickAddProvider({
  members,
  templates,
  activeMemberId,
  children,
}: {
  members: MemberOption[];
  templates: TemplateOption[];
  activeMemberId: string;
  children: ReactNode;
}) {
  const [openState, setOpenState] = useState(false);
  const open = useCallback(() => setOpenState(true), []);
  const close = useCallback(() => setOpenState(false), []);

  // Manifest shortcut deep link — "/?new=1" (Android long-press → "Add
  // expense") opens the sheet once on arrival. The param is read, not
  // cleared: it only acts on initial mount, so refreshes on other pages
  // are unaffected.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("new") === "1") {
      setOpenState(true);
    }
  }, []);

  return (
    <QuickAddContext.Provider value={{ open }}>
      {children}
      <QuickAddSheet
        open={openState}
        onOpenChange={setOpenState}
        members={members}
        templates={templates}
        activeMemberId={activeMemberId}
        onClose={close}
      />
    </QuickAddContext.Provider>
  );
}

export function useQuickAdd() {
  const ctx = useContext(QuickAddContext);
  if (!ctx) throw new Error("useQuickAdd must be used within QuickAddProvider");
  return ctx;
}
