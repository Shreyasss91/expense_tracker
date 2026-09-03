/**
 * §3.7 — one pluralisation helper for the whole app. The ledger and the
 * review queue used to format counts differently ("1 transaction"/"2
 * transactions" vs bare counts), so identical situations read differently
 * depending on the surface.
 */
export function plural(n: number, singularWord: string, pluralWord?: string): string {
  return `${n} ${n === 1 ? singularWord : (pluralWord ?? `${singularWord}s`)}`;
}

/**
 * §3.7 — the four empty-state copy pairs, standardised. A filtered-to-empty
 * list explains itself and suggests the fix; a genuinely empty ledger invites
 * the first expense. Both list surfaces (ledger + review queue) read from
 * here so the wording can never drift apart again.
 */
export function emptyStateCopy(hasFilters: boolean): { title: string; hint: string } {
  return hasFilters
    ? { title: "No transactions found", hint: "Try clearing the filters." }
    : { title: "Nothing here yet", hint: "Log your first expense in seconds." };
}
