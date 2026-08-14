"use client";

import type { TransactionListRow } from "@/lib/query";

/**
 * Optimistic mutation bus between mutation surfaces (Quick Add sheet, edit
 * dialog, settings) and the transactions list. The list applies each mutation
 * locally instead of refetching — the server action runs in parallel and
 * confirms/reverts through the create-confirm / create-revert / update events.
 */
export const LEDGER_MUTATION_EVENT = "ledger:mutation";

export type LedgerMutation =
  /** Optimistic insert of a not-yet-confirmed row (tempId until the action returns). */
  | { kind: "create"; tempId: string; row: TransactionListRow }
  /** The create action succeeded — swap the tempId for the real database id. */
  | { kind: "create-confirm"; tempId: string; id: string }
  /** The create action failed — drop the optimistic row. */
  | { kind: "create-revert"; tempId: string }
  /** Optimistic replace of an existing row (re-emitted with the old row to revert). */
  | { kind: "update"; id: string; row: TransactionListRow }
  /** Rare, non-derivable change (settings rename) — refetch the first page. */
  | { kind: "refetch" };

export function emitLedgerMutation(mutation: LedgerMutation) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(LEDGER_MUTATION_EVENT, { detail: mutation }));
  }
}
