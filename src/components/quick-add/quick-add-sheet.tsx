"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { Delete, ChevronLeft, Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { createTransaction } from "@/actions/transactions";
import { updateCategory } from "@/actions/settings";
import { emitLedgerMutation } from "@/lib/events";
import { formatINR, paiseToDbString } from "@/lib/money";
import { formatInTimeZone } from "date-fns-tz";
import { APP_TIMEZONE, TRANSACTION_TAGS, TRANSACTION_TAG_LABELS } from "@/lib/constants";
import type { TransactionListRow } from "@/lib/query";
import type { CategoryOption, MemberOption } from "./types";

type Step = "amount" | "category" | "details";
type TxnType = "expense" | "income";
type Tag = (typeof TRANSACTION_TAGS)[number];

const NUM_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"] as const;

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
  const [step, setStep] = useState<Step>("amount");
  const [buf, setBuf] = useState("");
  const [type, setType] = useState<TxnType>("expense");
  const [tag, setTag] = useState<Tag>("lifestyle");
  const [date, setDate] = useState(() => formatInTimeZone(new Date(), APP_TIMEZONE, "yyyy-MM-dd"));
  const [time, setTime] = useState(() => formatInTimeZone(new Date(), APP_TIMEZONE, "HH:mm"));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameEmoji, setRenameEmoji] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [cats, setCats] = useState(categories);
  const router = useRouter();

  // Keep the local category copy in sync with server-provided data when not mid-edit,
  // so renames done elsewhere (Settings) also land in this picker.
  useEffect(() => {
    if (!editMode && !renamingId) setCats(categories);
  }, [categories, editMode, renamingId]);

  const paise = useMemo(() => Math.round(parseFloat(buf || "0") * 100) || 0, [buf]);
  const activeMember = members.find((m) => m.id === activeMemberId) ?? members[0];

  function reset() {
    setStep("amount");
    setBuf("");
    setType("expense");
    setTag("lifestyle");
    setNote("");
    setDate(formatInTimeZone(new Date(), APP_TIMEZONE, "yyyy-MM-dd"));
    setTime(formatInTimeZone(new Date(), APP_TIMEZONE, "HH:mm"));
    setEditMode(false);
    setRenamingId(null);
    setRenameValue("");
    setRenameEmoji("");
  }

  function handleKey(k: string) {
    setBuf((prev) => {
      if (k === "back") return prev.slice(0, -1);
      if (k === ".") {
        if (prev.includes(".")) return prev;
        return prev === "" ? "0." : prev + ".";
      }
      const [intPart, decPart] = prev.split(".");
      if (decPart !== undefined && decPart.length >= 2) return prev; // max 2 decimals
      if (decPart === undefined && intPart.length >= 8) return prev; // max ₹99,99,999
      return prev + k;
    });
  }

  async function submit(catId: string) {
    if (paise <= 0 || saving) return;
    const member = members.find((m) => m.id === activeMemberId) ?? members[0];
    const category = cats.find((c) => c.id === catId);
    if (!member || !category) return;

    // §6.2 step 5 — fully optimistic: build the row locally and apply it to the
    // ledger immediately; the server action confirms (tempId → real id) or
    // reverts (row removed) when it resolves.
    const tempId = `temp-${crypto.randomUUID()}`;
    const optimisticRow: TransactionListRow = {
      id: tempId,
      memberId: member.id,
      categoryId: category.id,
      type,
      tag: type === "expense" ? tag : null,
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
    // §5.2 discriminated union: expense carries a tag, income forbids one
    const base = {
      memberId: activeMemberId, // server reads the cookie anyway (§6.2)
      categoryId: catId,
      amount: paise,
      date,
      time,
      note: note || null,
    };
    const payload =
      type === "expense"
        ? { ...base, type: "expense" as const, tag }
        : { ...base, type: "income" as const, tag: undefined };
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

  const stepTitle = step === "amount" ? "How much?" : step === "category" ? "What was it?" : "Details";

  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { reset(); onClose(); } }}>
      <SheetContent side="bottom" className="mx-auto max-w-2xl rounded-t-2xl px-4 pb-6 sm:px-6" showCloseButton={false}>
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted" />
        <div className="mb-2 flex items-center gap-2">
          {step !== "amount" && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditMode(false); setRenamingId(null); setStep(step === "category" ? "details" : "amount"); }} aria-label="Back">
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          <h2 className="text-base font-semibold">{stepTitle}</h2>
          {activeMember && (
            <span className="ml-auto flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              <span>{activeMember.emoji}</span>
              {activeMember.name}
            </span>
          )}
        </div>

        {step === "amount" && (
          <div className="flex flex-col">
            <div className="py-6 text-center">
              <div className="text-5xl font-bold tracking-tight tabular-nums">
                {formatINR(paise)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">Enter amount</div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {NUM_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => handleKey(k)}
                  className="flex h-14 items-center justify-center rounded-xl bg-muted text-2xl font-medium active:scale-95 active:bg-muted-foreground/20"
                >
                  {k === "back" ? <Delete className="h-6 w-6" /> : k}
                </button>
              ))}
            </div>
            <Button className="mt-4 h-12 text-base" disabled={paise <= 0} onClick={() => setStep("details")}>
              Next
            </Button>
          </div>
        )}

        {step === "category" && (
          <div className="flex max-h-[min(72vh,32rem)] flex-col">
            {/* confirm bar — category is the final step, so it previews the full entry */}
            <div className="mb-3 rounded-xl bg-muted px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xl font-bold leading-tight tabular-nums">{formatINR(paise)}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white ${type === "income" ? "bg-emerald-600" : "bg-destructive"}`}
                    >
                      {type === "income" ? "Income" : "Expense"}
                    </span>
                    {type === "expense" && (
                      <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {TRANSACTION_TAG_LABELS[tag]}
                      </span>
                    )}
                    {activeMember && (
                      <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {activeMember.emoji} {activeMember.name}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                    {format(new Date(`${date}T00:00:00`), "d MMM yyyy")} · {time}
                  </div>
                  {note ? (
                    <div className="mt-0.5 max-w-[15rem] truncate text-[11px] text-muted-foreground">“{note}”</div>
                  ) : null}
                </div>
                <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1 px-2.5 text-xs" onClick={() => setStep("details")}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-muted-foreground/10 pt-1.5">
                <span className="text-[11px] text-muted-foreground">
                  {editMode ? "Tap a category to rename" : "Tap a category to save"}
                </span>
                {editMode ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                    onClick={() => { setEditMode(false); setRenamingId(null); }}
                  >
                    <Check className="h-3 w-3" /> Done
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                    onClick={() => setEditMode(true)}
                  >
                    <Pencil className="h-3 w-3" /> Rename categories
                  </Button>
                )}
              </div>
            </div>
            {/* grid scrolls internally; the confirm bar stays pinned above it */}
            <div className="grid min-h-0 flex-1 grid-cols-3 gap-2 overflow-y-auto">
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
                          if (e.key === "Enter") void saveRename(c);
                          if (e.key === "Escape") cancelRename();
                        }}
                        className="h-8 min-w-0 flex-1 text-center text-xs"
                        aria-label="Category name"
                        maxLength={50}
                      />
                    </div>
                    <div className="flex justify-center gap-1">
                      <Button size="icon" className="h-6 w-6" disabled={renaming} onClick={() => void saveRename(c)} aria-label="Save name and emoji">
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6" disabled={renaming} onClick={cancelRename} aria-label="Cancel rename">
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    key={c.id}
                    type="button"
                    disabled={renaming}
                    onClick={() => void (editMode ? startRename(c) : submit(c.id))}
                    className="relative flex flex-col items-center gap-1 rounded-xl border p-3 active:scale-95 disabled:opacity-60"
                    style={{ borderColor: c.color }}
                  >
                    {editMode && (
                      <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground" aria-hidden>
                        <Pencil className="h-2.5 w-2.5" />
                      </span>
                    )}
                    <span className="text-2xl">{c.emoji}</span>
                    <span className="text-center text-xs font-medium leading-tight">{c.name}</span>
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {step === "details" && (
          <div className="space-y-4">
            {/* type toggle */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setType("expense")}
                className={`h-10 rounded-lg text-sm font-medium ${type === "expense" ? "bg-destructive text-white" : "bg-muted text-muted-foreground"}`}
              >
                Expense
              </button>
              <button
                type="button"
                onClick={() => setType("income")}
                className={`h-10 rounded-lg text-sm font-medium ${type === "income" ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground"}`}
              >
                Income
              </button>
            </div>

            {/* tag selector — mandatory for expense, hidden and cleared for income (§5.2) */}
            {type === "expense" ? (
              <div>
                <Label className="mb-1.5 text-xs text-muted-foreground">Tag</Label>
                <div className="grid grid-cols-3 gap-2">
                  {TRANSACTION_TAGS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTag(t)}
                      className={`flex h-9 items-center justify-center gap-1 rounded-lg text-xs font-medium ${tag === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                    >
                      {tag === t && <Check className="h-3.5 w-3.5" />}
                      {TRANSACTION_TAG_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

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
              <Textarea id="qa-note" rows={2} placeholder="What was it for?" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            <Button className="h-12 w-full text-base" disabled={paise <= 0} onClick={() => setStep("category")}>
              Next
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
