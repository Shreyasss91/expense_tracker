"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { updateTransaction } from "@/actions/transactions";
import { createTemplate } from "@/actions/templates";
import { getCategoryBudgetStatus } from "@/actions/settings";
import { useCategoryUsage } from "@/lib/category-usage";
import { useCreateCategory } from "@/lib/use-create-category";
import { formatINRWhole, paiseToDbString, rupeesToPaise } from "@/lib/money";
import { budgetAlertMessage } from "@/lib/budget-alert";
import { isGenericNote } from "@/lib/generic-notes";
import { emitLedgerMutation } from "@/lib/events";
import type { TransactionListRow } from "@/lib/query";
import type { CategoryOption, MemberOption } from "@/components/quick-add/types";
import { AmountTagRow, CategoryGrid, DateTimeField, type TransactionTag } from "./transaction-fields";

/**
 * Edit transaction — a bottom sheet with the same shell, header pattern
 * (clickable title + member dropdown chip), field order, and sticky CTA as
 * Quick Add, so both forms feel like the same page (Amendment 12 §2). The
 * member chip here reassigns *this transaction's* member (a local form
 * field, validated on save) rather than the app-wide active member cookie
 * that Quick Add's chip switches.
 */
export function TransactionEditDialog({
  row,
  members,
  categories,
  open,
  onOpenChange,
  onRequestDelete,
  onSaved,
}: {
  row: TransactionListRow | null;
  members: MemberOption[];
  categories: CategoryOption[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onRequestDelete: (row: TransactionListRow) => void;
  /** Optional post-save callback (Amendment 20) — used by the Review queue to
   * re-evaluate an item's membership after its note/category changed. */
  onSaved?: (row: TransactionListRow) => void;
}) {
  const [tag, setTag] = useState<TransactionTag>("lifestyle");
  const [categoryId, setCategoryId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // always starts collapsed on open, not persisted (matches Quick Add)
  const [showDatePicker, setShowDatePicker] = useState(false);
  // §6.7 — remaining budget per category for the row's month (mirrors Quick Add)
  const [budgetRemaining, setBudgetRemaining] = useState<Map<string, number> | null>(null);
  // local category list — syncs from the server prop so a category created inline
  // (or in Quick Add) shows up without remounting the sheet
  const [cats, setCats] = useState(categories);
  useEffect(() => {
    setCats(categories);
  }, [categories]);

  // (Re)initialise the form whenever a different row is opened.
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (row && row.id !== lastKey) {
    setLastKey(row.id);
    setTag((row.tag ?? "lifestyle") as TransactionTag);
    // Amendment 20 — uncategorized rows start with no selection; saving without
    // one is valid ("Uncategorized" is a state, not an error).
    setCategoryId(row.categoryId ?? "");
    setMemberId(row.memberId);
    setAmount(Number(row.amount).toString());
    setDate(row.date);
    setTime(row.time.slice(0, 5));
    setNote(row.note ?? "");
    setError(null);
    setSaving(false);
    setSubmitAttempted(false);
    setShowDatePicker(false);
  }

  const paise = rupeesToPaise(amount);
  const canSubmit = paise > 0 && memberId !== "";
  const activeMember = members.find((m) => m.id === memberId);
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
    if (!row || saving) return;
    if (!Number.isFinite(paise) || paise <= 0) {
      setSubmitAttempted(true);
      setError("Enter a valid amount");
      return;
    }
    const member = members.find((m) => m.id === memberId);
    // empty selection = uncategorized — a deliberate, valid choice (Amendment 20)
    const category = categoryId ? categories.find((c) => c.id === categoryId) : null;
    if (!member) {
      setSubmitAttempted(true);
      setError("Pick a member");
      return;
    }

    setSaving(true);
    // Fully optimistic: build the updated row locally, apply it and close the
    // sheet immediately; on failure the original row is emitted back.
    const originalRow = row;
    const updatedRow: TransactionListRow = {
      ...row,
      memberId,
      categoryId: category?.id ?? null,
      tag: tag as TransactionListRow["tag"],
      amount: paiseToDbString(paise),
      note: note || null,
      date,
      time: `${time}:00`,
      member: { name: member.name, emoji: member.emoji, color: member.color, slug: member.slug },
      category: category
        ? { name: category.name, emoji: category.emoji, color: category.color, slug: category.slug }
        : null,
    };
    emitLedgerMutation({ kind: "update", id: row.id, row: updatedRow });
    onOpenChange(false);
    const base = { memberId, categoryId: category?.id ?? null, amount: paise, date, time, note: note || null };
    const payload = { ...base, tag: tag as "one_time" | "recurring" | "lifestyle" };
    let res: Awaited<ReturnType<typeof updateTransaction>>;
    try {
      res = await updateTransaction(originalRow.id, payload);
    } catch {
      emitLedgerMutation({ kind: "update", id: originalRow.id, row: originalRow });
      setSaving(false);
      toast.error("Could not save");
      return;
    }
    setSaving(false);
    if (res.ok) {
      toast.success("Transaction updated");
      // §6.7 — warn when the edited expense left the month or its category over budget
      if (res.alert) toast.warning(budgetAlertMessage(res.alert));
      // §6.2 — record the category as used so recently used ones float to the top
      if (category) touchCategory(category.id);
      onSaved?.(updatedRow);
    } else {
      emitLedgerMutation({ kind: "update", id: originalRow.id, row: originalRow });
      toast.error(res.error ?? "Could not save");
    }
  }

  async function saveAsTemplate() {
    if (savingTemplate) return;
    const category = cats.find((c) => c.id === categoryId);
    if (!category || paise <= 0) {
      toast.error("Enter an amount and pick a category first");
      return;
    }
    const trimmedNote = note.trim();
    const name = trimmedNote && !isGenericNote(trimmedNote) && trimmedNote.toLowerCase() !== category.name.toLowerCase()
      ? trimmedNote
      : category.name;
    setSavingTemplate(true);
    const result = await createTemplate({
      name,
      categoryId: category.id,
      tag,
      amount: paise,
      note: trimmedNote || null,
    });
    setSavingTemplate(false);
    if (result.ok) toast.success("Template saved");
    else toast.error(result.error ?? "Could not save template");
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) cancelAddCategory();
      }}
    >
      <SheetContent side="bottom" className="mx-auto flex max-h-[92dvh] max-w-2xl flex-col rounded-t-2xl px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6" showCloseButton={false}>
        <div className="mx-auto mb-1 h-1.5 w-10 rounded-full bg-muted" />
        <div className="mb-1 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-full px-3"
          >
            Edit transaction
          </Button>
          {activeMember && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 gap-1 rounded-full bg-muted px-2.5 text-xs text-muted-foreground hover:bg-muted"
                >
                  <span>{activeMember.emoji}</span>
                  {activeMember.name}
                  <ChevronsUpDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Reassign to</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {members.map((m) => (
                  <DropdownMenuItem key={m.id} onSelect={() => setMemberId(m.id)} className="gap-2">
                    <span className="text-base">{m.emoji}</span>
                    <span className="flex-1">{m.name}</span>
                    {m.id === activeMember.id && <Check className="h-4 w-4 text-primary" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* a real <form> so Enter submits from any input — same shell as Quick Add */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-2">
          <DateTimeField
            date={date}
            time={time}
            onDateChange={setDate}
            onTimeChange={setTime}
            dateId="ed-date"
            timeId="ed-time"
            collapsible
            showPicker={showDatePicker}
            onTogglePicker={() => setShowDatePicker((v) => !v)}
          />

          <AmountTagRow
            amountId="ed-amount"
            amount={amount}
            onAmountChange={setAmount}
            amountInvalid={submitAttempted && paise <= 0}
            tag={tag}
            onTagChange={setTag}
          />

          <div className="space-y-1.5">
            <Label htmlFor="ed-note" className="text-xs text-muted-foreground">Note (optional)</Label>
            <Input
              id="ed-note"
              placeholder="What was it for?"
              value={note}
              maxLength={140}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <CategoryGrid
            categories={orderedCategories}
            selectedId={categoryId}
            onSelect={setCategoryId}
            budgetRemaining={budgetRemaining}
            hint="Optional — tap to categorize, None leaves it uncategorized"
            allowClear
            onAddCategory={openAddCategory}
            addForm={addForm}
          />
        </div>

        <div className="border-t border-muted-foreground/10 pt-3">
          {error && <p className="mb-2 text-sm font-medium text-destructive">{error}</p>}
          <Button type="button" variant="outline" className="mb-2 w-full" onClick={() => void saveAsTemplate()} disabled={savingTemplate}>
            {savingTemplate ? "Saving template…" : "Save as template"}
          </Button>
          {!saving && (
            <p className="mb-1.5 text-center text-[11px] text-muted-foreground">
              {canSubmit ? "press Enter ↵ to save" : "Enter an amount"}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-12 w-12 shrink-0 text-destructive"
              aria-label="Delete transaction"
              onClick={() => {
                if (row) onRequestDelete(row);
                onOpenChange(false);
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button type="submit" className="h-12 flex-1 text-base" disabled={!canSubmit || saving}>
              {saving
                ? "Saving…"
                : canSubmit
                  ? `Save ${formatINRWhole(paise)}${categoryId ? ` · ${cats.find((c) => c.id === categoryId)?.name ?? ""}` : ""}`
                  : "Save changes"}
            </Button>
          </div>
        </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
