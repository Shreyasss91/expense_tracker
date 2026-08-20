"use client";

import { useEffect, useState } from "react";
import { getPendingReviewCount } from "@/actions/transactions";

export function usePendingReviewCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const next = await getPendingReviewCount();
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
