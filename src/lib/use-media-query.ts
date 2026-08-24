"use client";

import { useEffect, useState } from "react";

/**
 * SSR-safe media-query hook. Defaults to false on the server and first
 * paint, then syncs — so sheets render as mobile-styled first and upgrade
 * to their docked variant after hydration on large screens.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Convenience: ≥lg breakpoint, where sheets dock into side panels. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}
