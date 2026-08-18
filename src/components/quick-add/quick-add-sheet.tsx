"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { createTransaction } from "@/actions/transactions";
import { getCategoryBudgetStatus, updateCategory } from "@/actions/settings";
import { emitLedgerMutation } from "@/lib/events";
import { paiseToDbString } from "@/lib/money";
import { budgetAlertMessage } from "@/lib/budget-alert";
import { formatInTimeZone } from "date-fns-tz";
import { APP_TIMEZONE } from "@/lib/constants";
import type { TransactionListRow } from "@/lib/query";
import type { CategoryOption, MemberOption } from "./types";
import { AmountField, CategoryGrid, TagSelector, type TransactionTag } from "@/components/transactions/transaction-fields";

export function QuickAddSheet({
  open,
  onOpenChange,
  members,
  categories,
  activeMemberId,
  onClose,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  members: MemberOption[];
  categories: CategoryOption[];
  activeMemberId: string;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [tag, setTag] = useState<TransactionTag>("lifestyle");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [date, setDate] = useState(() => formatInTimeZone(new Date(), APP_TIMEZONE, "yyyy-MM-dd"));
  const [time, setTime] = useState(() => formatInTimeZone(new Date(), APP_TIMEZONE, "HH:mm"));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameEmoji, setRenameEmoji] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [cats, setCats] = useState(categories);
  // §6.7 — remaining budget per category for the current date's month (expense only)
  const [budgetRemaining, setBudgetRemaining] = useState<Map<string, number> | null>(null);
  const router = useRouter();

  // Keep the local category copy in sync with server-provided data when not mid-edit,
  // so renames done elsewhere (Settings) also land in this picker.
  useEffect(() => {
    if (!editMode && !renamingId) setCats(categories);
  }, [categories, editMode, renamingId]);

  const paise = useMemo(() => Math.round(parseFloat(amount || "0") * 100) || 0, [amount]);
  const activeMember = members.find((m) => m.id === activeMemberId) ?? members[0];

  // §6.7 — fetch remaining budget per category for the transaction's month; only
  // meaningful for expenses, and only once the amount is set. Debounced so the
  // per-keystroke amount changes on the single page don't spam the server action.
  useEffect(() => {
    if (paise <= 0) {
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

  function reset() {
    setAmount("");
    setTag("lifestyle");
    setSelectedCategoryId("");
    setNote("");
    setError(null);
    setDate(formatInTimeZone(new Date(), APP_TIMEZONE, "yyyy-MM-dd"));
    setTime(formatInTimeZone(new Date(), APP_TIMEZONE, "HH:mm"));
    setEditMode(false);
    setRenamingId(null);
    setRenameValue("");
    setRenameEmoji("");
  }

  async function submit() {
    if (paise <= 0 || saving) return;
    const member = members.find((m) => m.id === activeMemberId) ?? members[0];
    const category = cats.find((c) => c.id === selectedCategoryId);
    if (!member || !category) {
      setError("Pick a category");
      return;
    }

    // §6.2 submit — fully optimistic: build the row locally and apply it to the
    // ledger immediately; the server action confirms (tempId → real id) or
    // reverts (row removed) when it resolves.
    const tempId = `temp-${crypto.randomUUID()}`;
    const optimisticRow: TransactionListRow = {
      id: tempId,
      memberId: member.id,
      categoryId: category.id,
      tag,
      amount: paiseToDbString(paise),
      note: note || null,
      date,
      time: `${time}:00`,
      createdAt: new Date().toISOString(),
      member: { name: member.name, emoji: member.emoji, color: member.color, slug: member.slug },
      category: { name: category.name, emoji: category.emoji, color: category.color, slug: category.slug },
    };
    emitLedgerMutation({ kind: "create", tempId, row: optimisticRow });

    setSaving(true);
    const base = {
      memberId: activeMemberId, // server reads the cookie anyway (§6.2)
      categoryId: category.id,
      amount: paise,
      date,
      time,
      note: note || null,
    };
    const payload = { ...base, tag };
    let res: Awaited<ReturnType<typeof createTransaction>>;
    try {
      res = await createTransaction(payload);
    } catch {
      emitLedgerMutation({ kind: "create-revert", tempId });
      setSaving(false);
      toast.error("Could not save");
      return;
    }
    setSaving(false);
    if (res.ok) {
      emitLedgerMutation({ kind: "create-confirm", tempId, id: res.id });
      toast.success("Transaction added");
      // §6.7 — warn when this expense pushed the month or its category over budget
      if (res.alert) toast.warning(budgetAlertMessage(res.alert));
      reset();
      onClose();
    } else {
      emitLedgerMutation({ kind: "create-revert", tempId });
      toast.error(res.error ?? "Could not save");
    }
  }

  function startRename(c: CategoryOption) {
    setRenamingId(c.id);
    setRenameValue(c.name);
    setRenameEmoji(c.emoji);
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameValue("");
    setRenameEmoji("");
  }

  async function saveRename(c: CategoryOption) {
    if (renaming) return;
    const name = renameValue.trim();
    const emoji = renameEmoji.trim();
    if ((!name || name === c.name) && emoji === c.emoji) {
      cancelRename();
      return;
    }
    const nextName = name || c.name;
    const nextEmoji = emoji || c.emoji;
    const prev = cats;
    // optimistic — the ledger already joins names fresh, so a refetch shows it everywhere
    setCats((list) => list.map((x) => (x.id === c.id ? { ...x, name: nextName, emoji: nextEmoji } : x)));
    setRenaming(true);
    const res = await updateCategory({ id: c.id, name: nextName, emoji: nextEmoji, sortOrder: c.sortOrder });
    setRenaming(false);
    if (res.ok) {
      toast.success("Category updated");
      emitLedgerMutation({ kind: "refetch" });
      router.refresh();
      setEditMode(false);
      setRenamingId(null);
      setRenameValue("");
      setRenameEmoji("");
    } else {
      setCats(prev);
      setRenamingId(null);
      setRenameValue("");
      setRenameEmoji("");
      toast.error(res.error ?? "Could not update");
    }
  }

  const canSubmit = paise > 0 && selectedCategoryId !== "";

  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { reset(); onClose(); } }}>
      <SheetContent side="bottom" className="mx-auto flex max-h-[92dvh] max-w-2xl flex-col rounded-t-2xl px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6" showCloseButton={false}>
        <div className="mx-auto mb-1 h-1.5 w-10 rounded-full bg-muted" />
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-base font-semibold">Add transaction</h2>
          {activeMember && (
            <span className="ml-auto flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              <span>{activeMember.emoji}</span>
              {activeMember.name}
            </span>
          )}
        </div>

        {/* single scrollable page — all fields visible, Add commits (§6.2).
            A real <form> so Enter submits from any input (Option B semantics). */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-2">
          {/* date/time sit at the top — their defaults are rarely changed, so the
              frequently edited fields (Amount → Tag → Note → Category) stay together */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="qa-date" className="text-xs text-muted-foreground">Date</Label>
              <Input id="qa-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qa-time" className="text-xs text-muted-foreground">Time</Label>
              <Input id="qa-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-10" />
            </div>
          </div>

          <AmountField id="qa-amount" value={amount} onChange={setAmount} autoFocus />

          <TagSelector value={tag} onChange={setTag} />

          <div className="space-y-1.5">
            <Label htmlFor="qa-note" className="text-xs text-muted-foreground">Note (optional)</Label>
            <Textarea
              id="qa-note"
              rows={2}
              placeholder="What was it for?"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                // Enter in a textarea inserts a newline; Cmd/Ctrl+Enter submits
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
          </div>

          <CategoryGrid
            categories={cats}
            selectedId={selectedCategoryId}
            onSelect={setSelectedCategoryId}
            budgetRemaining={budgetRemaining}
            showBudgetHints={!editMode}
            editMode={editMode}
            onToggleEditMode={() => setEditMode(true)}
            onExitEditMode={() => { setEditMode(false); setRenamingId(null); }}
            renamingId={renamingId}
            renameValue={renameValue}
            renameEmoji={renameEmoji}
            renaming={renaming}
            onRenameValueChange={setRenameValue}
            onRenameEmojiChange={setRenameEmoji}
            onStartRename={startRename}
            onSaveRename={(c) => void saveRename(c)}
            onCancelRename={cancelRename}
          />
        </div>

        <div className="border-t border-muted-foreground/10 pt-3">
          {error && <p className="mb-2 text-sm font-medium text-destructive">{error}</p>}
          {canSubmit && !saving && (
            <p className="mb-1.5 text-center text-[11px] text-muted-foreground">Tip: press Enter ↵ to add</p>
          )}
          <Button type="submit" className="h-12 w-full text-base" disabled={!canSubmit || saving}>
            {saving ? "Adding…" : "Add transaction"}
          </Button>
        </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
