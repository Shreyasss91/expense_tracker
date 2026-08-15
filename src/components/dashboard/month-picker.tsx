"use client";

import { useRouter } from "next/navigation";
import { format, addMonths, parse } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MonthPicker({ month }: { month: string }) {
  const router = useRouter();
  const current = parse(`${month}-01`, "yyyy-MM-dd", new Date());
  const label = format(current, "MMMM yyyy");

  function go(delta: number) {
    router.push(`/?month=${format(addMonths(current, delta), "yyyy-MM")}`);
  }

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => go(-1)} aria-label="Previous month">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-[8.5rem] text-center text-base font-semibold sm:min-w-[9.5rem] sm:text-lg">{label}</span>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => go(1)} aria-label="Next month">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
