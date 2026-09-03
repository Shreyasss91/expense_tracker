"use client";

import { useEffect } from "react";

/**
 * §3.7 — the Esc-exits-selection-mode effect, duplicated in the ledger list
 * and the review queue. Also broadcasts on unmount so a surface unmounting
 * mid-selection always clears the global FAB-hidden state.
 */
export function useEscToExit(active: boolean, onExit: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onExit]);
}
