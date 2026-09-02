"use client";

import { ChevronDown, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buildExportUrl } from "@/lib/export-format";
import type { TransactionListFilters } from "@/lib/query";

/**
 * §2.10 — export is now a format menu rather than one CSV button.
 *
 * The four shapes answer four different questions:
 *
 *   CSV (full)     16 columns — ids, slugs, group, reviewed_at, shared/split,
 *                  receipt locators. For moving data into another tool.
 *   CSV (7-col)    the canonical seed.csv contract. Smaller, and the only
 *                  shape `db:seed` reads back.
 *   JSON           full-fidelity backup — lossless types, ISO timestamps,
 *                  amounts in both rupees and paise. The restore format.
 *   XLSX           a real spreadsheet: numbers as numbers, frozen header, so
 *                  you can pivot it without any cleanup.
 *
 * Every item is a plain `<a download>` rather than a fetch: the endpoint is a
 * session-authenticated GET, so the browser sends the cookie, streams the
 * response straight to disk, and shows its own progress. Nothing buffers a
 * multi-megabyte export in a JS string in the tab.
 *
 * The links carry the ledger's active filters, so the file always describes
 * exactly what was on screen.
 */
function filtersToParams(filters?: TransactionListFilters): Record<string, string> {
  const params: Record<string, string> = {};
  if (!filters) return params;
  if (filters.memberId) params.member = filters.memberId;
  if (filters.uncategorized) params.category = "uncategorized";
  else if (filters.categoryId) params.category = filters.categoryId;
  else if (filters.groupId) params.group = filters.groupId;
  if (filters.tag) params.tag = filters.tag;
  if (filters.month) params.month = filters.month;
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  // Stored in paise; the URL (and the user) speak rupees.
  if (filters.amountMin) params.amount_min = String(filters.amountMin / 100);
  if (filters.amountMax) params.amount_max = String(filters.amountMax / 100);
  if (filters.search?.trim()) params.q = filters.search.trim();
  return params;
}

export function ExportButton({ filters }: { filters?: TransactionListFilters }) {
  const params = filtersToParams(filters);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <Download className="h-3.5 w-3.5" />
          Export
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Download this view</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={buildExportUrl("csv", params, "extended")} download>
            <span className="flex-1">
              CSV — full
              <span className="block text-xs text-muted-foreground">16 columns, every field</span>
            </span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={buildExportUrl("csv", params, "canonical")} download>
            <span className="flex-1">
              CSV — 7-column
              <span className="block text-xs text-muted-foreground">seed.csv format, re-importable</span>
            </span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={buildExportUrl("json", params)} download>
            <span className="flex-1">
              JSON — backup
              <span className="block text-xs text-muted-foreground">lossless, restores with ids</span>
            </span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={buildExportUrl("xlsx", params)} download>
            <span className="flex-1">
              Excel — .xlsx
              <span className="block text-xs text-muted-foreground">numbers as numbers, pivot-ready</span>
            </span>
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
