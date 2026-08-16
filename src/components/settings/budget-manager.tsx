"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveBudgets } from "@/actions/settings";
import type { CategoryOption } from "@/components/quick-add/types";

interface BudgetRow {
  month: string | null;
  categoryId: string | null;
  amount: string;
}

interface BudgetManagerProps {
  categories: CategoryOption[];
  /** Month options for the scope select — newest first, each { key: 'yyyy-MM', label } */
  months: { key: string; label: string }[];
  /** Every budget row, so the client can switch scope without a refetch */
  initialBudgets: BudgetRow[];
}

/** §5.8 — rupees string (as typed) → integer paise; empty/invalid → 0. */
function rupeesToPaiseInput(value: string): number {
  const n = parseFloat(value.replace(/[₹,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

function paiseToRupeesInput(paise: number): string {
  return paise > 0 ? String(paise / 100) : "";
}

/**
 * §6.7 Budget manager. One scope at a time: "Every month" (month = null,
 * the default) or a single 'yyyy-MM'. For each scope you set a total limit
 * and optional per-category limits; empty inputs mean "no limit". Saving
 * replaces the whole scope in one transaction.
 */
export function BudgetManager({ categories, months, initialBudgets }: BudgetManagerProps) {
  const router = useRouter();
  const [scope, setScope] = useState<string>("");
  const [totalInput, setTotalInput] = useState("");

  // Effective value for a category in a given scope (explicitly passed, never
  // the state — so switchScope can resolve the NEW scope before it's applied):
  // exact-month row wins, otherwise the every-month default row.
  const effectivePaise = (scopeKey: string, categoryId: string | null): number => {
    const exact = initialBudgets.find((b) => b.month === scopeKey && b.categoryId === categoryId);
    const fallback = initialBudgets.find((b) => b.month === null && b.categoryId === categoryId);
    const row = exact ?? fallback;
    return row ? Math.round(parseFloat(row.amount) * 100) : 0;
  };

  const [catInputs, setCatInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(categories.map((c) => [c.id, paiseToRupeesInput(effectivePaise("", c.id))])),
  );

  function switchScope(next: string) {
    setScope(next);
    setTotalInput(paiseToRupeesInput(effectivePaise(next, null)));
    setCatInputs(Object.fromEntries(categories.map((c) => [c.id, paiseToRupeesInput(effectivePaise(next, c.id))])));
  }

  async function save() {
    const res = await saveBudgets({
      month: scope === "" ? null : scope,
      totalPaise: rupeesToPaiseInput(totalInput),
      categories: categories.map((c) => ({ categoryId: c.id, paise: rupeesToPaiseInput(catInputs[c.id] ?? "") })),
    });
    if (res.ok) {
      toast.success(scope === "" ? "Default budget saved" : "Budget saved");
      router.refresh();
    } else {
      toast.error(res.error ?? "Could not save budget");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="budget-scope" className="text-xs text-muted-foreground">
          Applies to
        </Label>
        <Select value={scope} onValueChange={switchScope}>
          <SelectTrigger id="budget-scope" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Every month</SelectItem>
            {months.map((m) => (
              <SelectItem key={m.key} value={m.key}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {scope === "" ? "Default limit — used for months without their own budget" : "Only this month"}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Label htmlFor="budget-total" className="w-32 shrink-0 text-sm">
          Total limit
        </Label>
        <Input
          id="budget-total"
          inputMode="decimal"
          placeholder="e.g. 50000"
          value={totalInput}
          onChange={(e) => setTotalInput(e.target.value)}
          className="w-40"
        />
      </div>

      <div className="border-t pt-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Category limits (optional)</p>
        <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <span className="w-6 text-center text-base">{c.emoji}</span>
              <span className="flex-1 truncate text-sm">{c.name}</span>
              <Input
                aria-label={`${c.name} limit`}
                inputMode="decimal"
                placeholder="No limit"
                value={catInputs[c.id] ?? ""}
                onChange={(e) => setCatInputs((prev) => ({ ...prev, [c.id]: e.target.value }))}
                className="h-8 w-32 text-right"
              />
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={save} className="gap-1.5">
          <Save className="size-4" />
          Save budget
        </Button>
        <p className="text-xs text-muted-foreground">Leave a field empty for no limit</p>
      </div>
    </div>
  );
}
