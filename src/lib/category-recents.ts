"use client";

// §6.5 — ids of categories created inline (Quick Add / edit dialog), per device,
// so Settings can show a "Recently created" strip. Purely a convenience hint —
// the authoritative list always comes from the server.
const RECENT_KEY = "quick-add:recent-categories";
const RECENT_LIMIT = 6;

export function loadRecentCategoryIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string").slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

export function recordRecentCategory(id: string) {
  try {
    const next = [id, ...loadRecentCategoryIds().filter((x) => x !== id)].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable (private mode, quota) — the strip is best-effort
  }
}
