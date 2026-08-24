"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronsUpDown } from "lucide-react";
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
import { createTransaction } from "@/actions/transactions";
import { updateActiveMember } from "@/actions/member";
import { emitLedgerMutation } from "@/lib/events";
import { formatINRWhole, paiseToDbString } from "@/lib/money";
import { budgetAlertMessage } from "@/lib/budget-alert";
import { formatInTimeZone } from "date-fns-tz";
import { APP_TIMEZONE, TRANSACTION_TAGS } from "@/lib/constants";
import type { TransactionListRow } from "@/lib/query";
import type { CategoryOption, MemberOption, TemplateOption } from "./types";
import { AmountTagRow, DateTimeField, type TransactionTag } from "@/components/transactions/transaction-fields";

// §6.2 — repeat entries (recharges, EMIs, rent) start with the last committed
// tag + note already filled in; the amount, date and time never repeat.
// Amendment 20 — categories are no longer part of Quick Add at all; they are
// assigned afterwards in the Ledger (edit dialog / bulk assign).
const LAST_ENTRY_KEY = "quick-add:last-entry";

function loadLastEntry(): { tag: TransactionTag; note: string } {
  const fallback = { tag: "lifestyle" as const, note: "" };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(LAST_ENTRY_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return fallback;
    const { tag, note } = parsed as { tag?: unknown; note?: unknown };
    return {
      tag: typeof tag === "string" && TRANSACTION_TAGS.some((t) => t === tag) ? (tag as TransactionTag) : "lifestyle",
      note: typeof note === "string" ? note : "",
    };
  } catch {
    return fallback;
  }
}

function saveLastEntry(entry: { tag: TransactionTag; note: string }) {
  try {
    window.localStorage.setItem(LAST_ENTRY_KEY, JSON.stringify(entry));
  } catch {
    // storage unavailable (private mode, quota) — remembering is best-effort
  }
}

export function QuickAddSheet({
  open,
  onOpenChange,
  members,
  templates,
  activeMemberId,
  onClose,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  members: MemberOption[];
  /** Kept for layout parity with the edit dialog; unused since Amendment 20. */
  categories?: CategoryOption[];
  templates: TemplateOption[];
  activeMemberId: string;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [tag, setTag] = useState<TransactionTag>("lifestyle");
  // Hidden category stamped only via a template prefill — never a visible field.
  const [templateCategoryId, setTemplateCategoryId] = useState<string | undefined>(undefined);
  const [date, setDate] = useState(() => formatInTimeZone(new Date(), APP_TIMEZONE, "yyyy-MM-dd"));
  const [time, setTime] = useState(() => formatInTimeZone(new Date(), APP_TIMEZONE, "HH:mm"));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // the member chip doubles as a switcher (§1); optimistic against the cookie
  // written by updateActiveMember, reverted if the switch fails
  const [localActiveMemberId, setLocalActiveMemberId] = useState(activeMemberId);
  useEffect(() => {
    setLocalActiveMemberId(activeMemberId);
  }, [activeMemberId]);
  // Amendment 11 §2 — always starts collapsed with today's date/default time on
  // every open; still toggleable within the current session/tab.
  const [showDatePicker, setShowDatePicker] = useState(false);
  // §6.2 — the last committed tag + note, restored on open and updated on save
  const lastEntryRef = useRef<{ tag: TransactionTag; note: string }>({ tag: "lifestyle", note: "" });
  const router = useRouter();

  // Hydrate the remembered tag/note after mount (never during SSR, so the
  // server-rendered defaults stay consistent with the client's first paint).
  useEffect(() => {
    lastEntryRef.current = loadLastEntry();
    setTag(lastEntryRef.current.tag);
    setNote(lastEntryRef.current.note);
  }, []);

  const paise = useMemo(() => Math.round(parseFloat(amount || "0") * 100) || 0, [amount]);
  const activeMember = members.find((m) => m.id === localActiveMemberId) ?? members[0];

  async function switchMember(memberId: string) {
    if (memberId === localActiveMemberId) return;
    const prev = localActiveMemberId;
    setLocalActiveMemberId(memberId); // optimistic — §1 member chip switch
    const res = await updateActiveMember(memberId);
    if (res.ok) {
      router.refresh();
    } else {
      setLocalActiveMemberId(prev);
      toast.error(res.error ?? "Could not switch member");
    }
  }

  function reset() {
    setAmount("");
    setTag(lastEntryRef.current.tag);
    setTemplateCategoryId(undefined);
    setNote(lastEntryRef.current.note);
    setError(null);
    setDate(formatInTimeZone(new Date(), APP_TIMEZONE, "yyyy-MM-dd"));
    setTime(formatInTimeZone(new Date(), APP_TIMEZONE, "HH:mm"));
    setShowDatePicker(false);
    setSubmitAttempted(false);
  }

  async function submit() {
    if (paise <= 0 || saving) {
      setSubmitAttempted(true);
      return;
    }
    const member = members.find((m) => m.id === localActiveMemberId) ?? members[0];
    if (!member) {
      setError("Pick a member");
      return;
    }

    // §6.2 submit — fully optimistic: build the row locally and apply it to the
    // ledger immediately; the server action confirms (tempId → real id) or
    // reverts (row removed) when it resolves. Uncategorized rows carry a null
    // category (Amendment 20).
    const tempId = `temp-${crypto.randomUUID()}`;
    const optimisticRow: TransactionListRow = {
      id: tempId,
      memberId: member.id,
      categoryId: templateCategoryId ?? null,
      tag,
      amount: paiseToDbString(paise),
      note: note || null,
      date,
      time: `${time}:00`,
      createdAt: new Date().toISOString(),
      reviewedAt: null,
      member: { name: member.name, emoji: member.emoji, color: member.color, slug: member.slug },
      category: null,
    };
    emitLedgerMutation({ kind: "create", tempId, row: optimisticRow });

    setSaving(true);
    let res: Awaited<ReturnType<typeof createTransaction>>;
    try {
      res = await createTransaction({
        memberId: localActiveMemberId, // server reads the cookie anyway (§6.2)
        categoryId: templateCategoryId ?? null,
        amount: paise,
        date,
        time,
        note: note || null,
        tag,
      });
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
      // §6.2 — remember the committed tag/note so repeat entries start filled in
      lastEntryRef.current = { tag, note };
      saveLastEntry(lastEntryRef.current);
      reset();
      onClose();
    } else {
      emitLedgerMutation({ kind: "create-revert", tempId });
      toast.error(res.error ?? "Could not save");
    }
  }

  const canSubmit = paise > 0;

  function applyTemplate(template: TemplateOption) {
    setAmount(String(template.amountPaise / 100));
    setTag(template.tag);
    // Templates carry their category — it rides along invisibly and is stamped
    // at commit; every other entry lands uncategorized (Amendment 20).
    setTemplateCategoryId(template.categoryId);
    setNote(template.note ?? "");
    setError(null);
    setSubmitAttempted(false);
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { reset(); onClose(); } }}>
      <SheetContent side="bottom" className="mx-auto flex max-h-[92dvh] max-w-2xl flex-col rounded-t-2xl px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6" showCloseButton={false}>
        <div className="mx-auto mb-1 h-1.5 w-10 rounded-full bg-muted" />
        <div className="mb-1 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void submit()}
            disabled={saving}
            className="rounded-full px-3"
          >
            Add transaction
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
                <DropdownMenuLabel>Who&apos;s adding this?</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {members.map((m) => (
                  <DropdownMenuItem key={m.id} onSelect={() => void switchMember(m.id)} className="gap-2">
                    <span className="text-base">{m.emoji}</span>
                    <span className="flex-1">{m.name}</span>
                    {m.id === activeMember.id && <Check className="h-4 w-4 text-primary" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
              frequently edited fields stay together; the pickers stay collapsed
              behind a summary until tapped */}
          <DateTimeField
            date={date}
            time={time}
            onDateChange={setDate}
            onTimeChange={setTime}
            dateId="qa-date"
            timeId="qa-time"
            collapsible
            showPicker={showDatePicker}
            onTogglePicker={() => setShowDatePicker((v) => !v)}
          />

          {templates.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Templates</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {templates.map((template) => (
                  <Button
                    key={template.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 rounded-full text-xs"
                    onClick={() => applyTemplate(template)}
                  >
                    {template.name} · {formatINRWhole(template.amountPaise)}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <AmountTagRow
            amountId="qa-amount"
            amount={amount}
            onAmountChange={setAmount}
            autoFocusAmount
            amountInvalid={submitAttempted && paise <= 0}
            tag={tag}
            onTagChange={setTag}
          />

          <div className="space-y-1.5">
            <Label htmlFor="qa-note" className="text-xs text-muted-foreground">Note (optional)</Label>
            <Input
              id="qa-note"
              placeholder="What was it for?"
              value={note}
              maxLength={140}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {/* Amendment 20 — no category picker here. Categorize later in the
              Ledger: tap a row to edit, or select many and assign at once. */}
        </div>

        <div className="border-t border-muted-foreground/10 pt-3">
          {error && <p className="mb-2 text-sm font-medium text-destructive">{error}</p>}
          {!saving && (
            <p className="mb-1.5 text-center text-[11px] text-muted-foreground">
              {canSubmit ? "press Enter ↵ to add" : "Enter an amount"}
            </p>
          )}
          <Button type="submit" className="h-12 w-full text-base" disabled={!canSubmit || saving}>
            {saving ? "Adding…" : canSubmit ? `Add ${formatINRWhole(paise)}` : "Add transaction"}
          </Button>
        </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
