// Pure ledger-filter URL logic — no React, no server-only, no DB: shared by
// the filter bar, the month strip and the server page, and exercised directly
// by src/lib/ledger-url-test.ts (F2-05: URL-filter composition / month-strip
// preservation is normative per §6.4).

import { z } from "zod";
import { TRANSACTION_TAGS } from "./constants";
import { dateSchema, monthKeySchema } from "./validations";
import { rupeesToPaise } from "./money";
import type { TransactionListFilters } from "./query";

/** The filter state as carried by the ledger URL. `q` is the search text. */
export interface LedgerFilters {
  memberId?: string;
  /** Leaf-category filter — serialized as `category=<uuid>`. */
  categoryId?: string;
  /**
   * Group filter (two-level hierarchy) — serialized as `group=<uuid>`.
   * Mutually exclusive with categoryId/uncategorized: a leaf selection
   * always wins, and the URL carries at most one of the three.
   */
  groupId?: string;
  /** Amendment 20 — serialized as `category=uncategorized`. */
  uncategorized?: boolean;
  tag?: "one_time" | "recurring" | "lifestyle";
  month?: string;
  /** UX pass — custom date range (inclusive), YYYY-MM-DD. */
  from?: string;
  to?: string;
  /** §2.7 — amount range, user-facing rupees strings ("2000"). */
  amountMin?: string;
  amountMax?: string;
  q?: string;
}

/** Sentinel category-filter value selecting rows with no category assigned. */
export const UNCATEGORIZED = "uncategorized";

/** Serialize the filter state into the ledger URL — shared by the filter bar and the month strip. */
export function buildLedgerUrl(filters: LedgerFilters): string {
  const params = new URLSearchParams();
  if (filters.memberId) params.set("member", filters.memberId);
  if (filters.uncategorized) params.set("category", UNCATEGORIZED);
  else if (filters.categoryId) params.set("category", filters.categoryId);
  else if (filters.groupId) params.set("group", filters.groupId);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.month) params.set("month", filters.month);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.amountMin?.trim()) params.set("amount_min", filters.amountMin.trim());
  if (filters.amountMax?.trim()) params.set("amount_max", filters.amountMax.trim());
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  const qs = params.toString();
  return qs ? `/transactions?${qs}` : "/transactions";
}

/**
 * §6.4 — the single, authoritative parse of the ledger `searchParams` into the
 * filter objects. The server page feeds the same result to the list query AND
 * the summary query, so the summary always describes exactly the filtered set.
 * Invalid values (bad UUIDs, unknown tags/months) are dropped silently —
 * an invalid filter is treated as "no filter", never as an error.
 */
export function parseLedgerSearchParams(
  sp: Record<string, string | string[] | undefined>,
): { filters: TransactionListFilters; ledgerFilters: LedgerFilters } {
  const read = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const uuid = z.string().uuid();

  const rawTag = read(sp.tag);
  const rawCategory = read(sp.category);
  const rawGroup = read(sp.group);
  const filters: TransactionListFilters = {
    memberId: (() => {
      const v = read(sp.member);
      return v && uuid.safeParse(v).success ? v : undefined;
    })(),
    categoryId: rawCategory && rawCategory !== UNCATEGORIZED && uuid.safeParse(rawCategory).success ? rawCategory : undefined,
    // Group filter only survives when no leaf/uncategorized selection exists.
    groupId:
      !rawCategory && rawGroup && uuid.safeParse(rawGroup).success ? rawGroup : undefined,
    uncategorized: rawCategory === UNCATEGORIZED,
    tag: rawTag && (TRANSACTION_TAGS as readonly string[]).includes(rawTag) ? (rawTag as TransactionListFilters["tag"]) : undefined,
    month: (() => {
      const v = read(sp.month);
      return v && monthKeySchema.safeParse(v).success ? v : undefined;
    })(),
    from: (() => {
      const v = read(sp.from);
      return v && dateSchema.safeParse(v).success ? v : undefined;
    })(),
    to: (() => {
      const v = read(sp.to);
      return v && dateSchema.safeParse(v).success ? v : undefined;
    })(),
    // §2.7 — amount range, parsed from rupees into paise. Invalid / non-positive
    // values are dropped (treated as "no bound"). If both bounds parse but min
    // exceeds max we swap them so the user never gets a silently empty result.
    amountMin: (() => {
      const v = read(sp.amount_min);
      return v && Number.isFinite(Number(v)) && Number(v) > 0 ? rupeesToPaise(v) : undefined;
    })(),
    amountMax: (() => {
      const v = read(sp.amount_max);
      return v && Number.isFinite(Number(v)) && Number(v) > 0 ? rupeesToPaise(v) : undefined;
    })(),
    search: read(sp.q)?.slice(0, 100),
  };

  // swap a reversed range so the query isn't vacuous
  if (filters.amountMin != null && filters.amountMax != null && filters.amountMin > filters.amountMax) {
    [filters.amountMin, filters.amountMax] = [filters.amountMax, filters.amountMin];
  }

  const rawAmountMin = read(sp.amount_min);
  const rawAmountMax = read(sp.amount_max);
  const ledgerAmountMin = filters.amountMin != null && rawAmountMin ? rawAmountMin.trim() : undefined;
  const ledgerAmountMax = filters.amountMax != null && rawAmountMax ? rawAmountMax.trim() : undefined;

  return {
    filters,
    ledgerFilters: { ...filters, q: filters.search, amountMin: ledgerAmountMin, amountMax: ledgerAmountMax },
  };
}
