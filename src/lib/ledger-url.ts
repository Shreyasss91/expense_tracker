// Pure ledger-filter URL logic — no React, no server-only, no DB: shared by
// the filter bar, the month strip and the server page, and exercised directly
// by src/lib/ledger-url-test.ts (F2-05: URL-filter composition / month-strip
// preservation is normative per §6.4).

import { z } from "zod";
import { TRANSACTION_TAGS } from "./constants";
import { monthKeySchema } from "./validations";
import type { TransactionListFilters } from "./query";

/** The filter state as carried by the ledger URL. `q` is the search text. */
export interface LedgerFilters {
  memberId?: string;
  categoryId?: string;
  tag?: "one_time" | "recurring" | "lifestyle";
  month?: string;
  type?: "income" | "expense";
  q?: string;
}

/** Serialize the filter state into the ledger URL — shared by the filter bar and the month strip. */
export function buildLedgerUrl(filters: LedgerFilters): string {
  const params = new URLSearchParams();
  if (filters.memberId) params.set("member", filters.memberId);
  if (filters.categoryId) params.set("category", filters.categoryId);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.month) params.set("month", filters.month);
  if (filters.type) params.set("type", filters.type);
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  const qs = params.toString();
  return qs ? `/transactions?${qs}` : "/transactions";
}

/**
 * §6.4 — the single, authoritative parse of the ledger `searchParams` into the
 * filter objects. The server page feeds the same result to the list query AND
 * the summary query, so the summary always describes exactly the filtered set.
 * Invalid values (bad UUIDs, unknown tags/types/months) are dropped silently —
 * an invalid filter is treated as "no filter", never as an error.
 */
export function parseLedgerSearchParams(
  sp: Record<string, string | string[] | undefined>,
): { filters: TransactionListFilters; ledgerFilters: LedgerFilters } {
  const read = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const uuid = z.string().uuid();

  const rawTag = read(sp.tag);
  const filters: TransactionListFilters = {
    memberId: (() => {
      const v = read(sp.member);
      return v && uuid.safeParse(v).success ? v : undefined;
    })(),
    categoryId: (() => {
      const v = read(sp.category);
      return v && uuid.safeParse(v).success ? v : undefined;
    })(),
    tag: rawTag && (TRANSACTION_TAGS as readonly string[]).includes(rawTag) ? (rawTag as TransactionListFilters["tag"]) : undefined,
    type: (() => {
      const v = read(sp.type);
      return v === "income" || v === "expense" ? v : undefined;
    })(),
    month: (() => {
      const v = read(sp.month);
      return v && monthKeySchema.safeParse(v).success ? v : undefined;
    })(),
    search: read(sp.q)?.slice(0, 100),
  };

  return { filters, ledgerFilters: { ...filters, q: filters.search } };
}
