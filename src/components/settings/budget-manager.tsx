"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveBudgets, setExcludeBills } from "@/actions/settings";
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
  /** Global "exclude bills (recurring) from the total budget" setting (§6.7). */
  excludeBills: boolean;
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

// Radix Select treats an empty-string item value as "nothing selected" (the
// trigger falls back to its placeholder), so the "Every month" scope uses a
// non-empty sentinel value and maps it to null/'' at the action boundary.
const DEFAULT_SCOPE = "__every_month__";

/**
 * §6.7 Budget manager. One scope at a time: "Every month" (month = null,
 * the default) or a single 'yyyy-MM'. For each scope you set a total limit
 * and optional per-category limits; empty inputs mean "no limit". Saving
 * replaces the whole scope in one transaction.
 */
export function BudgetManager({ categories, months, initialBudgets, excludeBills }: BudgetManagerProps) {
  const router = useRouter();
  const [excludeBillsOn, setExcludeBillsOn] = useState(excludeBills);
  const [togglingBills, setTogglingBills] = useState(false);

  // Budgets are LEAF-only + total (§6.7) — group rows never carry a limit and
  // the server rejects them, so every input/row below is built from leaves,
  // ordered by their group's sortOrder.
  const { leavesByGroup } = (() => {
    const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
    const groupRows = sorted.filter((c) => c.parentId === null);
    return {
      leavesByGroup: groupRows.map((g) => ({
        group: g,
        leaves: sorted.filter((c) => c.parentId === g.id),
      })),
    };
  })();
  const leaves = leavesByGroup.flatMap(({ leaves }) => leaves);

  // Effective value for a category in a given scope (explicitly passed, never
  // the state — so switchScope can resolve the NEW scope before it's applied):
  // exact-month row wins, otherwise the every-month default row. "" is the
  // default scope's key; declared before the state hooks so the lazy
  // initializers below can use it.
  const effectivePaise = (scopeKey: string, categoryId: string | null): number => {
    const exact = initialBudgets.find((b) => b.month === scopeKey && b.categoryId === categoryId);
    const fallback = initialBudgets.find((b) => b.month === null && b.categoryId === categoryId);
    const row = exact ?? fallback;
    return row ? Math.round(parseFloat(row.amount) * 100) : 0;
  };

  const [scope, setScope] = useState<string>(DEFAULT_SCOPE);
  // Pre-fill from the saved default scope — an empty initial value made a
  // re-save silently wipe the existing budget (empty input = no limit).
  const [totalInput, setTotalInput] = useState(() => paiseToRupeesInput(effectivePaise("", null)));
  const [catInputs, setCatInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(leaves.map((c) => [c.id, paiseToRupeesInput(effectivePaise("", c.id))])),
  );
  // §6.7 — when the category list gains ids (a category created inline from Quick
  // Add / the edit dialog), give each new category a clean input row. The id-set
  // guard never touches values the user has already typed.
  const catIdsRef = useRef(leaves.map((c) => c.id).sort().join(","));
  useEffect(() => {
    const ids = leaves.map((c) => c.id).sort().join(",");
    if (ids !== catIdsRef.current) {
      catIdsRef.current = ids;
      setCatInputs((prev) => {
        const next = { ...prev };
        for (const c of leaves) if (!(c.id in next)) next[c.id] = "";
        return next;
      });
    }
  }, [categories, leaves]);

  function switchScope(next: string) {
    const scopeKey = next === DEFAULT_SCOPE ? "" : next;
    setScope(next);
    setTotalInput(paiseToRupeesInput(effectivePaise(scopeKey, null)));
    setCatInputs(Object.fromEntries(leaves.map((c) => [c.id, paiseToRupeesInput(effectivePaise(scopeKey, c.id))])))
  }

  async function save() {
    const res = await saveBudgets({
      month: scope === DEFAULT_SCOPE ? null : scope,
      totalPaise: rupeesToPaiseInput(totalInput),
      categories: leaves.map((c) => ({ categoryId: c.id, paise: rupeesToPaiseInput(catInputs[c.id] ?? "") })),
    });
    if (res.ok) {
      toast.success(scope === DEFAULT_SCOPE ? "Default budget saved" : "Budget saved");
      router.refresh();
    } else {
      toast.error(res.error ?? "Could not save budget");
    }
  }

  // §6.7 — global toggle, applied immediately (not part of the scope save).
  async function toggleExcludeBills(next: boolean) {
    if (togglingBills) return;
    setTogglingBills(true);
    const res = await setExcludeBills({ enabled: next });
    setTogglingBills(false);
    if (res.ok) {
      toast.success(next ? "Bills excluded from budgets" : "Bills count toward budgets");
      router.refresh();
    } else {
      setExcludeBillsOn(!next); // revert the optimistic flip on failure
      toast.error(res.error ?? "Could not save setting");
    }
  }

  return (
    <div className="space-y-4">
      {/* §6.7 — global exclude-bills toggle; affects every scope's total budget */}
      <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
        <div className="space-y-0.5">
          <Label htmlFor="budget-exclude-bills" className="text-sm font-medium">
            Exclude bills from budgets
          </Label>
          <p className="text-xs text-muted-foreground">
            Recurring-tagged expenses (rent, EMIs, recharges…) won&apos;t count against the total
            monthly limit. Category limits still count everything.
          </p>
        </div>
        <Switch
          id="budget-exclude-bills"
          checked={excludeBillsOn}
          disabled={togglingBills}
          onCheckedChange={(next) => {
            setExcludeBillsOn(next);
            void toggleExcludeBills(next);
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="budget-scope" className="text-xs text-muted-foreground">
          Applies to
        </Label>
        <Select value={scope} onValueChange={switchScope}>
          <SelectTrigger id="budget-scope" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_SCOPE}>Every month</SelectItem>
            {months.map((m) => (
              <SelectItem key={m.key} value={m.key}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {scope === DEFAULT_SCOPE ? "Default limit — used for months without their own budget" : "Only this month"}
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
          {leavesByGroup.map(({ group, leaves: kids }) => (
            <li key={group.id}>
              <p className="mt-2 mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground" style={{ color: group.color }}>
                {group.emoji} {group.name}
              </p>
              <ul className="space-y-1.5">
                {kids.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 pl-3">
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
