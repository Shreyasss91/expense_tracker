"use client";

/** Fired after any successful mutation so open list views can refresh their first page. */
export const LEDGER_REFRESH_EVENT = "ledger:refresh";

export function notifyLedgerChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LEDGER_REFRESH_EVENT));
  }
}
