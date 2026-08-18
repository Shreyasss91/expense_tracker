"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { updateTransaction } from "@/actions/transactions";
import { getCategoryBudgetStatus } from "@/actions/settings";
import { useCategoryUsage } from "@/lib/category-usage";
import { useCreateCategory } from "@/lib/use-create-category";
import { paiseToDbString, rupeesToPaise } from "@/lib/money";
import { budgetAlertMessage } from "@/lib/budget-alert";
import { emitLedgerMutation } from "@/lib/events";
import type { TransactionListRow } from "@/lib/query";
import type { CategoryOption, MemberOption } from "@/components/quick-add/types";
import { AmountField, CategoryGrid, DateTimeField, TagSelector, type TransactionTag } from "./transaction-fields";

export function TransactionEditDialog({
  row,
  members,
  categories,
  open,
  onOpenChange,
  onRequestDelete,
}: {
  row: TransactionListRow | null;
  members: MemberOption[];
  categories: CategoryOption[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onRequestDelete: (row: TransactionListRow) => void;
}) {
  const [tag, setTag] = useState<TransactionTag>("lifestyle");
  const [categoryId, setCategoryId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  // §6.7 — remaining budget per category for the row's month (mirrors Quick Add)
  const [budgetRemaining, setBudgetRemaining] = useState<Map<string, number> | null>(null);
  // local category list — syncs from the server prop so a category created inline
  // (or in Quick Add) shows up without remounting the dialog
  const [cats, setCats] = useState(categories);
  useEffect(() => {
    setCats(categories);
  }, [categories]);

  // (Re)initialise the form whenever a different row is opened.
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (row && row.id !== lastKey) {
    setLastKey(row.id);
    setTag((row.tag ?? "lifestyle") as TransactionTag);
    setCategoryId(row.categoryId);
    setMemberId(row.memberId);
    setAmount(Number(row.amount).toString());
    setDate(row.date);
    setTime(row.time.slice(0, 5));
    setNote(row.note ?? "");
    setError(null);
  }

  const paise = rupeesToPaise(amount);
  // §6.2 — recently used categories float to the top, same as the Quick Add grid
  const { orderedCategories, touchCategory } = useCategoryUsage(cats);
  // §6.2/§6.5 — inline "add a new category" flow, same as Quick Add
  const { open: openAddCategory, cancel: cancelAddCategory, addForm } = useCreateCategory(
    useCallback((c: CategoryOption) => {
      setCats((list) => [...list, c]);
      setCategoryId(c.id);
    }, []),
  );

  // §6.7 — fetch remaining budget per category for the row's month; debounced so
  // per-keystroke amount edits don't spam the server action (same as Quick Add).
  useEffect(() => {
    if (!(paise > 0)) {
      setBudgetRemaining(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void getCategoryBudgetStatus(date.slice(0, 7)).then((res) => {
        if (cancelled) return;
        setBudgetRemaining(res.ok ? new Map(res.categories.map((c) => [c.categoryId, c.remainingPaise])) : null);
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [paise, date]);

  async function save() {
    if (!row) return;
    if (!Number.isFinite(paise) || paise <= 0) {
      setError("Enter a valid amount");
      return;
    }
    const member = members.find((m) => m.id === memberId);
    const category = categories.find((c) => c.id === categoryId);
    if (!member || !category) {
      setError("Pick a member and category");
      return;
    }

    // Fully optimistic: build the updated row locally, apply it and close the
    // dialog immediately; on failure the original row is emitted back.
    const originalRow = row;
    emitLedgerMutation({
      kind: "update",
      id: row.id,
      row: {
        ...row,
        memberId,
        categoryId,
        tag: tag as TransactionListRow["tag"],
        amount: paiseToDbString(paise),
        note: note || null,
        date,
        time: `${time}:00`,
        member: { name: member.name, emoji: member.emoji, color: member.color, slug: member.slug },
        category: { name: category.name, emoji: category.emoji, color: category.color, slug: category.slug },
      },
    });
    onOpenChange(false);
    const base = { memberId, categoryId, amount: paise, date, time, note: note || null };
    const payload = { ...base, tag: tag as "one_time" | "recurring" | "lifestyle" };
    let res: Awaited<ReturnType<typeof updateTransaction>>;
    try {
      res = await updateTransaction(originalRow.id, payload);
    } catch {
      emitLedgerMutation({ kind: "update", id: originalRow.id, row: originalRow });
      toast.error("Could not save");
      return;
    }
    if (res.ok) {
      toast.success("Transaction updated");
      // §6.7 — warn when the edited expense left the month or its category over budget
      if (res.alert) toast.warning(budgetAlertMessage(res.alert));
      // §6.2 — record the category as used so recently used ones float to the top
      touchCategory(category.id);
    } else {
      emitLedgerMutation({ kind: "update", id: originalRow.id, row: originalRow });
      toast.error(res.error ?? "Could not save");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) cancelAddCategory();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{row?.category.emoji ?? "📝"}</span> Edit transaction
          </DialogTitle>
        </DialogHeader>

        {/* a real <form> so Enter submits from any input (same as Quick Add) */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          {/* date/time first, mirroring the Quick Add sheet (§6.2) */}
          <DateTimeField
            date={date}
            time={time}
            onDateChange={setDate}
            onTimeChange={setTime}
            dateId="ed-date"
            timeId="ed-time"
          />

          <AmountField id="ed-amount" value={amount} onChange={setAmount} />

          <TagSelector value={tag} onChange={setTag} />

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Member</Label>
            <Select value={memberId} onValueChange={setMemberId}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.emoji} {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ed-note" className="text-xs text-muted-foreground">Note (optional)</Label>
            <Textarea
              id="ed-note"
              rows={2}
              placeholder="What was it for?"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                // Enter in a textarea inserts a newline; Cmd/Ctrl+Enter submits
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void save();
                }
              }}
            />
          </div>

          <CategoryGrid
            categories={orderedCategories}
            selectedId={categoryId}
            onSelect={setCategoryId}
            budgetRemaining={budgetRemaining}
            onAddCategory={openAddCategory}
            addForm={addForm}
          />

          {error && <p className="text-sm font-medium text-destructive">{error}</p>}

          <p className="text-center text-[11px] text-muted-foreground">Tip: press Enter ↵ to save</p>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              className="mr-auto"
              onClick={() => {
                if (row) onRequestDelete(row);
                onOpenChange(false);
              }}
            >
              Delete
            </Button>
            <Button type="submit">
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
