"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setTotalBudget } from "@/actions/settings";
import { BudgetBar, BudgetRemaining } from "@/components/dashboard/budget-bar";
import { formatINR } from "@/lib/money";

/**
 * §6.7 — the Overview Budget card. Shows the total spent vs the effective
 * budget for the month, with an inline edit/clear shortcut: tap the pencil to
 * set a new total limit (or clear it). Editing writes the total row for this
 * exact month only — category budgets and other months are untouched.
 */
export function BudgetCard({
  monthKey,
  totalPaise,
  expensePaise,
  billsPaise,
  excludeBills,
  hasCategoryBudgets,
}: {
  monthKey: string;
  totalPaise: number | null;
  expensePaise: number;
  /** Recurring-tagged spend this month — the "bills" the budget can exclude (§6.7). */
  billsPaise: number;
  /** Global setting: subtract recurring spend from the total-budget comparison. */
  excludeBills: boolean;
  hasCategoryBudgets: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(totalPaise !== null ? String(totalPaise / 100) : "");
  const [saving, setSaving] = useState(false);
  // §6.7 — with exclude-bills on, the bar compares discretionary spend (total − bills)
  const spentPaise = excludeBills ? Math.max(0, expensePaise - billsPaise) : expensePaise;

  function startEdit() {
    setValue(totalPaise !== null ? String(totalPaise / 100) : "");
    setEditing(true);
  }

  async function save(clear: boolean) {
    if (saving) return;
    const paise = clear ? null : Math.round(parseFloat(value.replace(/[₹,\s]/g, "")) * 100);
    if (!clear && (!Number.isFinite(paise) || (paise ?? 0) <= 0)) {
      toast.error("Enter a valid amount");
      return;
    }
    setSaving(true);
    const res = await setTotalBudget({ month: monthKey, totalPaise: paise });
    setSaving(false);
    if (res.ok) {
      toast.success(clear ? "Budget cleared" : "Budget saved");
      setEditing(false);
      router.refresh();
    } else {
      toast.error(res.error ?? "Could not save budget");
    }
  }

  const body =
    totalPaise === null && !hasCategoryBudgets ? (
      <p className="text-xs text-muted-foreground">
        No budget set for this month.{" "}
        <Link href="/settings" className="text-foreground underline">
          Set one in Settings
        </Link>
      </p>
    ) : totalPaise === null ? (
      <p className="text-xs text-muted-foreground">
        Category budgets are set — see them under Spending by category.
      </p>
    ) : (
      <div className="space-y-1">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-semibold tabular-nums">{formatINR(spentPaise)}</span>
          <span className="text-xs text-muted-foreground">of {formatINR(totalPaise)}</span>
        </div>
        <BudgetBar spent={spentPaise} budget={totalPaise} />
        <BudgetRemaining spent={spentPaise} budget={totalPaise} />
        {excludeBills && billsPaise > 0 && (
          <p className="text-[11px] text-muted-foreground">excluding {formatINR(billsPaise)} in bills</p>
        )}
      </div>
    );

  return (
    <div className="space-y-2">
      {body}
      {editing ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            autoFocus
            inputMode="decimal"
            placeholder="Monthly limit in ₹"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save(false);
              if (e.key === "Escape") setEditing(false);
            }}
            className="h-8 w-36"
            aria-label="Monthly budget limit"
          />
          <Button size="sm" disabled={saving} onClick={() => void save(false)}>
            <Check className="size-3.5" /> Save
          </Button>
          {totalPaise !== null && (
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => void save(true)}>
              Clear
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)} aria-label="Cancel">
            <X className="size-3.5" />
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="xs"
          className="gap-1 text-muted-foreground"
          onClick={startEdit}
          aria-label="Edit monthly budget"
        >
          <Pencil className="size-3" /> {totalPaise !== null ? "Edit" : "Set budget"}
        </Button>
      )}
    </div>
  );
}
