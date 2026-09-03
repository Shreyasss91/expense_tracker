"use client";

import { formatINR } from "@/lib/money";

export interface CompareMatrixMonth {
  key: string;
  label: string;
}

export interface CompareMatrixRow {
  id: string | null;
  name: string;
  emoji: string;
  months: Record<string, number>;
  total: number;
}

/**
 * §2.12 — category × month matrix answering "is fuel creeping up?".
 * Pure presentational: the dashboard already fetches trailing-6mo per-category
 * sums (catMonthly), so this renders them as a table with a total column.
 */
export function CompareMatrix({
  months,
  rows,
}: {
  months: CompareMatrixMonth[];
  rows: CompareMatrixRow[];
}) {
  if (rows.length === 0) return null;
  const top = [...rows].sort((a, b) => b.total - a.total).slice(0, 12);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-xs tabular-nums">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="pb-1 pr-2 font-medium">Category</th>
            {months.map((m) => (
              <th key={m.key} className="pb-1 pr-2 text-right font-medium">
                {m.label}
              </th>
            ))}
            <th className="pb-1 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {top.map((r) => (
            <tr key={r.id ?? "uncategorized"} className="border-t">
              <td className="max-w-[140px] truncate py-1 pr-2">
                {r.emoji} {r.name}
              </td>
              {months.map((m) => (
                <td key={m.key} className="py-1 pr-2 text-right text-muted-foreground">
                  {r.months[m.key] ? formatINR(r.months[m.key]) : "—"}
                </td>
              ))}
              <td className="py-1 text-right font-medium">{formatINR(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
