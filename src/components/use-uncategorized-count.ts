"use client";

import { useEffect, useState } from "react";
import { getUncategorizedCount } from "@/actions/transactions";

/** Amendment 20 — polls the uncategorized count so the Ledger nav item can
 * nudge when entries are waiting to be categorized. Same cadence as the
 * pending-review badge. */
export function useUncategorizedCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const next = await getUncategorizedCount();
      if (active) setCount(next);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return count;
}
