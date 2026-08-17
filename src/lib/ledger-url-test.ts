/**
 * Ledger URL/filter composition test — `npm run test:ledger-url`.
 *
 * Phase-2 hardening (F2-05): §6.4 makes URL-driven filter composition
 * normative — changing one filter must preserve every other, clearing the
 * month must preserve the rest, clearing all must yield `/transactions`, and
 * the server-side parse must drop invalid values (never error). This test
 * exercises `buildLedgerUrl` and `parseLedgerSearchParams` directly — no DB,
 * no server-only, pure module.
 */
import { buildLedgerUrl, parseLedgerSearchParams, type LedgerFilters } from "./ledger-url";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

const UUID_A = "00000000-0000-4000-8000-00000000000a";
const UUID_B = "00000000-0000-4000-8000-00000000000b";

function paramsOf(url: string): URLSearchParams {
  return new URLSearchParams(url.split("?")[1] ?? "");
}

const full: LedgerFilters = {
  memberId: UUID_A,
  categoryId: UUID_B,
  tag: "lifestyle",
  month: "2026-08",
  q: "  petrol  ",
};

function main() {
  // --- Serialization: every filter lands in the URL; q is trimmed.
  const url = buildLedgerUrl(full);
  check(url.startsWith("/transactions?"), "all filters produce a query string");
  const p = paramsOf(url);
  check(p.get("member") === UUID_A, "memberId → ?member");
  check(p.get("category") === UUID_B, "categoryId → ?category");
  check(p.get("tag") === "lifestyle", "tag → ?tag");
  check(p.get("month") === "2026-08", "month → ?month");
  check(p.get("q") === "petrol", "search → ?q, trimmed");

  // --- Composition: changing ONE filter preserves every other.
  const nextMonth = buildLedgerUrl({ ...full, month: "2026-07" });
  const np = paramsOf(nextMonth);
  check(
    np.get("month") === "2026-07" &&
      np.get("member") === UUID_A &&
      np.get("category") === UUID_B &&
      np.get("tag") === "lifestyle" &&
      np.get("q") === "petrol",
    "changing the month preserves member/category/tag/q",
  );
  // --- Clearing the month (All) preserves the rest.
  const clearedMonth = buildLedgerUrl({ ...full, month: undefined });
  const cp = paramsOf(clearedMonth);
  check(
    !cp.has("month") &&
      cp.get("member") === UUID_A &&
      cp.get("category") === UUID_B &&
      cp.get("tag") === "lifestyle" &&
      cp.get("q") === "petrol",
    "clearing the month (All) preserves the other filters",
  );

  // --- Clearing everything → bare /transactions.
  check(buildLedgerUrl({}) === "/transactions", "no filters → /transactions");
  check(buildLedgerUrl({ q: "   " }) === "/transactions", "whitespace-only search → /transactions");

  // --- Parsing: valid params decode into the filter objects.
  const sp: Record<string, string> = {
    member: UUID_A,
    category: UUID_B,
    tag: "recurring",
    month: "2026-08",
    q: "internet",
  };
  const { filters, ledgerFilters } = parseLedgerSearchParams(sp);
  check(filters.memberId === UUID_A && filters.categoryId === UUID_B, "parse: member/category UUIDs decode");
  check(filters.tag === "recurring" && filters.month === "2026-08", "parse: tag/month decode");
  check(filters.search === "internet" && ledgerFilters.q === "internet", "parse: search maps to both search and q");
  check(
    ledgerFilters.memberId === filters.memberId && ledgerFilters.month === filters.month,
    "parse: the ledger filter object mirrors the query filter object",
  );

  // --- Parsing: invalid values are dropped silently, never an error.
  const dirty = parseLedgerSearchParams({
    member: "not-a-uuid",
    category: "also-not-a-uuid",
    tag: "bogus",
    month: "aug-2026",
    type: "transfer",
    q: "x",
  });
  check(dirty.filters.memberId === undefined, "invalid member UUID dropped");
  check(dirty.filters.categoryId === undefined, "invalid category UUID dropped");
  check(dirty.filters.tag === undefined, "unknown tag dropped");
  check(dirty.filters.month === undefined, "malformed month dropped");
  check(dirty.filters.search === "x", "search survives (free text)");

  // --- Round-trip: parse(buildLedgerUrl(filters)) reproduces the filters.
  const round = parseLedgerSearchParams(Object.fromEntries(paramsOf(buildLedgerUrl(full)).entries()));
  check(
    round.filters.memberId === UUID_A &&
      round.filters.categoryId === UUID_B &&
      round.filters.tag === "lifestyle" &&
      round.filters.month === "2026-08" &&
      round.filters.search === "petrol",
    "parse ∘ buildLedgerUrl round-trips the full filter set",
  );

  if (failures > 0) {
    console.error(`✗ Ledger URL composition FAILED (${failures} check(s) failed)`);
    process.exitCode = 1;
  } else {
    console.log("✓ Ledger URL composition OK — filters compose, clear and round-trip per §6.4.");
  }
}

main();
