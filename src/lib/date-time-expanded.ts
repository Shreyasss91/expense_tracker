// §6.2 / Amendment 10 §4 — the Date/Time row's collapsed/expanded choice
// persists per device and is shared by Quick Add and the edit dialog so
// expanding it once in either form keeps it expanded in both.
const DATE_TIME_EXPANDED_KEY = "quick-add:date-time-expanded";

export function loadDateTimeExpanded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DATE_TIME_EXPANDED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveDateTimeExpanded(expanded: boolean) {
  try {
    window.localStorage.setItem(DATE_TIME_EXPANDED_KEY, expanded ? "1" : "0");
  } catch {
    // storage unavailable — remembering is best-effort
  }
}
