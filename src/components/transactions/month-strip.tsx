"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { format, parse } from "date-fns";
import { cn } from "@/lib/utils";
import { buildLedgerUrl, type LedgerFilters } from "@/lib/ledger-url";

function chip(active: boolean) {
  return cn(
    // §3.4 — h-11 (44px) meets the minimum touch-target size.
    "h-11 shrink-0 rounded-full px-3.5 text-xs font-medium transition-colors",
    active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted-foreground/10",
  );
}

/**
 * Quick month navigation for the ledger. The window is generated on the server
 * (last 36 months in IST, §5.7) and covers the whole seeded history; "All"
 * clears the month filter and also reaches anything outside the window.
 * Navigating a month preserves every other active filter.
 */
export function MonthStrip({
  months,
  selected,
  filters,
}: {
  months: string[];
  selected?: string;
  filters: LedgerFilters;
}) {
  const router = useRouter();
  const refs = useRef(new Map<string, HTMLButtonElement>());

  // §3.6 — center the selected month ONLY on a real month change, never on
  // mount: firing scrollIntoView on every mount yanked the whole page on each
  // navigation. The first render (mountedRef false → true) skips the scroll;
  // subsequent selection changes scroll instantly (auto, not smooth — the
  // smooth animation ran even when the strip was already positioned).
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (selected) refs.current.get(selected)?.scrollIntoView({ behavior: "auto", inline: "center", block: "nearest" });
  }, [selected]);

  function pushMonth(month?: string) {
    router.push(buildLedgerUrl({ ...filters, month }));
  }

  return (
    <div className="flex snap-x items-center gap-2 overflow-x-auto pb-1">
      <button type="button" className={chip(!selected)} onClick={() => pushMonth(undefined)}>
        All
      </button>
      {months.map((m) => (
        <button
          key={m}
          ref={(el) => {
            if (el) refs.current.set(m, el);
            else refs.current.delete(m);
          }}
          type="button"
          className={cn(chip(selected === m), "snap-center")}
          onClick={() => pushMonth(m)}
        >
          {format(parse(`${m}-01`, "yyyy-MM-dd", new Date()), "MMM yy")}
        </button>
      ))}
    </div>
  );
}
