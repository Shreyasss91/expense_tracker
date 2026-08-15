"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { format, parse } from "date-fns";
import { cn } from "@/lib/utils";
import { buildLedgerUrl, type LedgerFilters } from "@/components/transactions/filters";

function chip(active: boolean) {
  return cn(
    "h-9 shrink-0 rounded-full px-3.5 text-xs font-medium transition-colors",
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

  // keep the selected month visible — center it when the strip or selection changes
  useEffect(() => {
    if (selected) refs.current.get(selected)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
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
