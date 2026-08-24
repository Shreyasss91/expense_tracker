"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportCsv } from "@/actions/transactions";
import type { TransactionListFilters } from "@/lib/query";

/** UX pass — exports honor the active ledger filter set; no props = all-time. */
export function ExportButton({ filters }: { filters?: TransactionListFilters }) {
  const [pending, setPending] = useState(false);

  async function run() {
    setPending(true);
    const res = await exportCsv(filters);
    setPending(false);
    if (!res.ok) {
      toast.error("Export failed");
      return;
    }
    const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Export downloaded");
  }

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={pending} className="h-8 gap-1.5">
      <Download className="h-3.5 w-3.5" />
      {pending ? "Exporting…" : "Export"}
    </Button>
  );
}
