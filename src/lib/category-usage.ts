"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CategoryOption } from "@/components/quick-add/types";

// §6.2 — per-category "last used" (epoch ms, client-local) so the Quick Add grid
// floats recently used categories to the top. Never-used categories keep the
// user's manual sortOrder from Settings.
const USAGE_KEY = "quick-add:category-usage";

export function loadCategoryUsage(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(USAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Record<string, number>;
  } catch {
    return {};
  }
}

function saveCategoryUsage(usage: Record<string, number>) {
  try {
    window.localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
  } catch {
    // storage unavailable (private mode, quota) — ordering is best-effort
  }
}

/** Sort by last-used recency (most recent first); never-used categories keep sortOrder. */
export function orderCategoriesByUsage(
  categories: CategoryOption[],
  usage: Record<string, number>,
): CategoryOption[] {
  return [...categories].sort((a, b) => {
    const ua = usage[a.id] ?? -1;
    const ub = usage[b.id] ?? -1;
    if (ua !== ub) return ub - ua;
    return a.sortOrder - b.sortOrder;
  });
}

/**
 * Loads per-category usage after mount (never during SSR, so the server-rendered
 * grid order stays consistent) and returns the categories re-ordered by recency,
 * plus touch() to record a successful commit for a category.
 */
export function useCategoryUsage(categories: CategoryOption[]) {
  const [usage, setUsage] = useState<Record<string, number>>({});
  const usageRef = useRef<Record<string, number>>({});

  useEffect(() => {
    usageRef.current = loadCategoryUsage();
    setUsage(usageRef.current);
  }, []);

  const orderedCategories = useMemo(
    () => orderCategoriesByUsage(categories, usage),
    [categories, usage],
  );

  const touchCategory = useCallback((id: string) => {
    const next = { ...usageRef.current, [id]: Date.now() };
    usageRef.current = next;
    saveCategoryUsage(next);
    setUsage(next);
  }, []);

  return { orderedCategories, touchCategory };
}
