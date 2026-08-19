/**
 * Generic note blocklist for the Review queue (§6.4).
 * A transaction is pending review iff reviewed_at IS NULL AND its note (after lower(btrim(note))) is:
 *  - empty/NULL, OR
 *  - an exact match against this blocklist, OR
 *  - equal to the transaction's category display name (redundant note).
 *
 * This is a code constant governed like the §6.2 keyword map.
 * Covered by test:generic-notes (DB-free).
 */
export const GENERIC_NOTE_BLOCKLIST = new Set([
  "hotel",
  "snacks",
  "tindi",
  "oota",
  "store",
  "more",
  "shyam",
  "spar",
  "hopcoms",
  "blinkit",
  "amazon",
  "firstcry",
  "westside",
  "hopscotch",
  "diana",
  "medplus",
  "bakery",
  "chips",
  "bonda",
  "petrol",
  "recharge",
  "internet",
  "vegetables",
  "tarakari",
  "fruits",
  "pampers",
  "wipes",
  "medicine",
  "misc",
  "other",
]);

/** Check if a normalized note is generic (empty or in blocklist). */
export function isGenericNote(note: string | null): boolean {
  if (!note || note.trim() === "") return true;
  const normalized = note.toLowerCase().trim();
  return GENERIC_NOTE_BLOCKLIST.has(normalized);
}
