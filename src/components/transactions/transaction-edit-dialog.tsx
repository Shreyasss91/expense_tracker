"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import { formatINR, rupeesToPaise } from "@/lib/money";
import { TRANSACTION_TAG_LABELS, TRANSACTION_TAGS } from "@/lib/constants";
import { notifyLedgerChanged } from "@/lib/events";
import type { TransactionListRow } from "@/lib/query";
import type { CategoryOption, MemberOption } from "@/components/quick-add/types";
import { cn } from "@/lib/utils";

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
  const [type, setType] = useState<"expense" | "income">("expense");
  const [tag, setTag] = useState<string>("lifestyle");
  const [categoryId, setCategoryId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // (Re)initialise the form whenever a different row is opened.
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (row && row.id !== lastKey) {
    setLastKey(row.id);
    setType(row.type);
    setTag(row.tag ?? "lifestyle");
    setCategoryId(row.categoryId);
    setMemberId(row.memberId);
    setAmount(Number(row.amount).toString());
    setDate(row.date);
    setTime(row.time.slice(0, 5));
    setNote(row.note ?? "");
    setError(null);
  }

  async function save() {
    if (!row) return;
    const paise = rupeesToPaise(amount);
    if (!Number.isFinite(paise) || paise <= 0) {
      setError("Enter a valid amount");
      return;
    }
    setSaving(true);
    // §5.2 discriminated union: expense carries a tag, income forbids one
    const base = { memberId, categoryId, amount: paise, date, time, note: note || null };
    const payload =
      type === "expense"
        ? { ...base, type: "expense" as const, tag: tag as "one_time" | "recurring" | "lifestyle" }
        : { ...base, type: "income" as const, tag: undefined };
    const res = await updateTransaction(row.id, payload);
    setSaving(false);
    if (res.ok) {
      toast.success("Transaction updated");
      notifyLedgerChanged();
      onOpenChange(false);
    } else {
      setError(res.error ?? "Could not save");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{row?.category.emoji ?? "📝"}</span> Edit transaction
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setType("expense")}
              className={cn("h-9 rounded-lg text-sm font-medium", type === "expense" ? "bg-destructive text-white" : "bg-muted text-muted-foreground")}
            >
              Expense
            </button>
            <button
              type="button"
              onClick={() => setType("income")}
              className={cn("h-9 rounded-lg text-sm font-medium", type === "income" ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground")}
            >
              Income
            </button>
          </div>

          {type === "expense" && (
            <div>
              <Label className="mb-1.5 text-xs text-muted-foreground">Tag</Label>
              <div className="grid grid-cols-3 gap-2">
                {TRANSACTION_TAGS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTag(t)}
                    className={cn(
                      "h-9 rounded-lg text-xs font-medium",
                      tag === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {TRANSACTION_TAG_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ed-amount" className="text-xs text-muted-foreground">Amount (₹)</Label>
              <Input id="ed-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-10" />
            </div>
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
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.emoji} {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Time</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Preview</Label>
              <div className="h-10 rounded-md border px-3 text-sm leading-10 tabular-nums text-muted-foreground">
                {amount ? formatINR(rupeesToPaise(amount)) : "—"}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ed-note" className="text-xs text-muted-foreground">Note</Label>
            <Textarea id="ed-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="destructive"
            className="mr-auto"
            onClick={() => {
              if (row) onRequestDelete(row);
              onOpenChange(false);
            }}
          >
            Delete
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
