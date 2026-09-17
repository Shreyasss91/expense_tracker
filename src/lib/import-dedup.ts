/**
 * Occurrence-aware natural-key matching for CSV restore (§2.10).
 *
 * A canonical CSV carries no ids, so restore recognises already-present rows
 * by fingerprint (date, time, member, amount, note). The database can hold
 * several identical rows legitimately (two equal fuel fills on the same
 * morning), so matching must consume occurrences one-for-one: each existing
 * row excuses exactly one import row. A Set would excuse every identical
 * import row after a single match and silently drop the missing copies.
 *
 * `wanted` parallels the import rows under consideration; a null entry means
 * the row has no resolvable member and can never match. Returns the positions
 * (indexes into `wanted`) that are already present.
 */
export function matchOccurrences(existing: string[], wanted: (string | null)[]): Set<number> {
  const remaining = new Map<string, number>();
  for (const fingerprint of existing) {
    remaining.set(fingerprint, (remaining.get(fingerprint) ?? 0) + 1);
  }
  const present = new Set<number>();
  wanted.forEach((fingerprint, position) => {
    if (fingerprint === null) return;
    const left = remaining.get(fingerprint) ?? 0;
    if (left > 0) {
      remaining.set(fingerprint, left - 1);
      present.add(position);
    }
  });
  return present;
}
