"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { QuickAddSheet } from "./quick-add-sheet";
import type { CategoryOption, MemberOption } from "./types";

interface QuickAddContextValue {
  open: () => void;
}

const QuickAddContext = createContext<QuickAddContextValue | null>(null);

export function QuickAddProvider({
  members,
  categories,
  activeMemberId,
  children,
}: {
  members: MemberOption[];
  categories: CategoryOption[];
  activeMemberId: string;
  children: ReactNode;
}) {
  const [openState, setOpenState] = useState(false);
  const open = useCallback(() => setOpenState(true), []);
  const close = useCallback(() => setOpenState(false), []);

  return (
    <QuickAddContext.Provider value={{ open }}>
      {children}
      <QuickAddSheet
        open={openState}
        onOpenChange={setOpenState}
        members={members}
        categories={categories}
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
