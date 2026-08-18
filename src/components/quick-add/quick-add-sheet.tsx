"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { createTransaction } from "@/actions/transactions";
import { getCategoryBudgetStatus, updateCategory } from "@/actions/settings";
import { emitLedgerMutation } from "@/lib/events";
import { formatINR, paiseToDbString } from "@/lib/money";
import { budgetAlertMessage } from "@/lib/budget-alert";
import { formatInTimeZone } from "date-fns-tz";
import { APP_TIMEZONE, TRANSACTION_TAGS, TRANSACTION_TAG_LABELS } from "@/lib/constants";
import type { TransactionListRow } from "@/lib/query";
import type { CategoryOption, MemberOption } from "./types";
import { cn } from "@/lib/utils";

type Tag = (typeof TRANSACTION_TAGS)[number];

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
  const [tag, setTag] = useState<Tag>("lifestyle");
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
          <div className="space-y-1.5">
            <Label htmlFor="qa-amount" className="text-xs text-muted-foreground">Amount (₹)</Label>
            <Input
              id="qa-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-12 text-2xl font-semibold tabular-nums"
              autoFocus
            />
            {paise > 0 && <p className="text-xs tabular-nums text-muted-foreground">≈ {formatINR(paise)}</p>}
          </div>

          {/* tag selector */}
          <div>
            <Label className="mb-1.5 text-xs text-muted-foreground">Tag</Label>
            <div className="grid grid-cols-3 gap-2">
              {TRANSACTION_TAGS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTag(t)}
                  className={cn(
                    "flex h-9 items-center justify-center gap-1 rounded-lg text-xs font-medium",
                    tag === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  {tag === t && <Check className="h-3.5 w-3.5" />}
                  {TRANSACTION_TAG_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

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

          {/* category grid — tap selects; Add commits */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Category</Label>
              {editMode ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                  onClick={() => { setEditMode(false); setRenamingId(null); }}
                >
                  <Check className="h-3 w-3" /> Done
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                  onClick={() => setEditMode(true)}
                >
                  <Pencil className="h-3 w-3" /> Rename categories
                </Button>
              )}
            </div>
            <p className="mb-2 text-[11px] text-muted-foreground">
              {editMode ? "Tap a category to rename" : "Tap a category to select it"}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {cats.map((c) =>
                renamingId === c.id ? (
                  <div key={c.id} className="flex flex-col gap-1 rounded-xl border p-2" style={{ borderColor: c.color }}>
                    <div className="flex gap-1">
                      <Input
                        value={renameEmoji}
                        onChange={(e) => setRenameEmoji(e.target.value)}
                        className="h-8 w-10 shrink-0 px-1 text-center text-base"
                        aria-label="Category emoji"
                        maxLength={4}
                      />
                      <Input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          // preventDefault stops Enter/Escape from also submitting the form
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void saveRename(c);
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            cancelRename();
                          }
                        }}
                        className="h-8 min-w-0 flex-1 text-center text-xs"
                        aria-label="Category name"
                        maxLength={50}
                      />
                    </div>
                    <div className="flex justify-center gap-1">
                      <Button type="button" size="icon" className="h-6 w-6" disabled={renaming} onClick={() => void saveRename(c)} aria-label="Save name and emoji">
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" className="h-6 w-6" disabled={renaming} onClick={cancelRename} aria-label="Cancel rename">
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    key={c.id}
                    type="button"
                    disabled={renaming}
                    onClick={() => void (editMode ? startRename(c) : setSelectedCategoryId(c.id))}
                    className={cn(
                      "relative flex flex-col items-center gap-1 rounded-xl border p-3 active:scale-95 disabled:opacity-60",
                      !editMode && selectedCategoryId === c.id && "ring-2 ring-primary",
                    )}
                    style={{ borderColor: c.color }}
                  >
                    {!editMode && selectedCategoryId === c.id && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden>
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                    {editMode && (
                      <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground" aria-hidden>
                        <Pencil className="h-2.5 w-2.5" />
                      </span>
                    )}
                    <span className="text-2xl">{c.emoji}</span>
                    <span className="text-center text-xs font-medium leading-tight">{c.name}</span>
                    {/* §6.7 — remaining budget hint, when this category has one for the month */}
                    {!editMode && budgetRemaining?.get(c.id) !== undefined && (
                      <span
                        className={`text-[10px] font-medium tabular-nums ${(budgetRemaining.get(c.id) ?? 0) < 0 ? "text-red-600" : "text-emerald-600"}`}
                      >
                        {(budgetRemaining.get(c.id) ?? 0) < 0
                          ? `${formatINR(-(budgetRemaining.get(c.id) ?? 0))} over`
                          : `${formatINR(budgetRemaining.get(c.id) ?? 0)} left`}
                      </span>
                    )}
                  </button>
                )
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-muted-foreground/10 pt-3">
          {error && <p className="mb-2 text-sm font-medium text-destructive">{error}</p>}
          <Button type="submit" className="h-12 w-full text-base" disabled={!canSubmit || saving}>
            {saving ? "Adding…" : "Add transaction"}
          </Button>
        </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
