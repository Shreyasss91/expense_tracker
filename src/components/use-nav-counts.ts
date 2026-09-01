"use client";

import { useEffect, useState } from "react";
import { getNavCounts } from "@/actions/transactions";

export interface NavCounts {
  pending: number;
  uncategorized: number;
}

/**
 * §1.9 — single poller for both bottom-nav badges (pending review +
 * uncategorized). Replaces usePendingReviewCount + useUncategorizedCount,
 * which each fired their own server action every 30s.
 *
 * Improvements over the old pair:
 *  - ONE network round-trip (getNavCounts) instead of two.
 *  - 60s cadence instead of 30s.
 *  - tab-visibility gated: the timer only runs while the tab is visible, so a
 *    backgrounded tab stops polling entirely (no wasted requests / battery).
 */
export function useNavCounts(): NavCounts {
  const [counts, setCounts] = useState<NavCounts>({ pending: 0, uncategorized: 0 });

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    const refresh = async () => {
      const next = await getNavCounts();
      if (active) setCounts(next);
    };

    const schedule = () => {
      // (re)start the 60s poller only when the tab is visible
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        timer = window.setInterval(() => void refresh(), 60_000);
      }
    };

    void refresh();
    schedule();

    const onVisibility = () => {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
      schedule();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      active = false;
      if (timer !== undefined) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return counts;
}
