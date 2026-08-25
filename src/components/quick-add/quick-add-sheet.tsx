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
import { enqueuePendingAdd } from "@/lib/offline-queue";
import { formatINRWhole, paiseToDbString } from "@/lib/money";
import { budgetAlertMessage } from "@/lib/budget-alert";
import { formatInTimeZone } from "date-fns-tz";
import { APP_TIMEZONE, TRANSACTION_TAGS } from "@/lib/constants";
import type { TransactionListRow } from "@/lib/query";
import type { MemberOption, TemplateOption } from "./types";
import { AmountTagRow, DateTimeField, type TransactionTag } from "@/components/transactions/transaction-fields";

// §6.2 — repeat entries (recharges, EMIs, rent) start with the last committed
// tag + note already filled in; the amount, date and time never repeat.
// Amendment 20 — categories are no longer part of Quick Add at all; they are
// assigned afterwards in the Ledger (edit dialog / bulk assign).
const LAST_ENTRY_KEY = "quick-add:last-entry";
// UX pass — recent distinct notes offered as one-tap chips while the Note
// field is empty. Per-device localStorage, same pattern as last-entry memory.
const RECENT_NOTES_KEY = "quick-add:recent-notes";
const RECENT_NOTES_MAX = 5;

function loadRecentNotes(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_NOTES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is string => typeof n === "string").slice(0, RECENT_NOTES_MAX);
  } catch {
    return [];
  }
}

function rememberNote(note: string, current: string[]): string[] {
  const trimmed = note.trim();
  if (!trimmed) return current;
  const next = [trimmed, ...current.filter((n) => n.toLowerCase() !== trimmed.toLowerCase())];
  const capped = next.slice(0, RECENT_NOTES_MAX);
  try {
    window.localStorage.setItem(RECENT_NOTES_KEY, JSON.stringify(capped));
  } catch {
    // storage unavailable — remembering is best-effort
  }
  return capped;
}

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
  // UX pass — recent distinct notes for one-tap refill
  const [recentNotes, setRecentNotes] = useState<string[]>([]);
  // Multi-entry mode: after a successful save the sheet STAYS OPEN with the
  // form reset and a confirmation banner ("Added ✓") offering Add-another /
  // Done — a grocery run of five items costs one open instead of five.
  const [justAdded, setJustAdded] = useState(false);
  const [addedCount, setAddedCount] = useState(0);
  const [lastAddedPaise, setLastAddedPaise] = useState(0);
  const router = useRouter();

  // Hydrate the remembered tag/note after mount (never during SSR, so the
  // server-rendered defaults stay consistent with the client's first paint).
  useEffect(() => {
    lastEntryRef.current = loadLastEntry();
    setTag(lastEntryRef.current.tag);
    setNote(lastEntryRef.current.note);
    setRecentNotes(loadRecentNotes());
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

    // Offline — commit to the device queue instead of the server. The row
    // stays in the ledger optimistically; the sync manager replays it through
    // the same action when connectivity returns (and after reloads, since the
    // queue lives in IndexedDB).
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await enqueuePendingAdd({
        clientId: crypto.randomUUID(),
        payload: {
          memberId: localActiveMemberId,
          categoryId: templateCategoryId ?? null,
          amount: paise,
          date,
          time,
          note: note || null,
          tag,
        },
        createdAt: Date.now(),
      });
      // same memory/multi-entry flow as an online save — capture stays friction-free
      lastEntryRef.current = { tag, note };
      saveLastEntry(lastEntryRef.current);
      setRecentNotes((prev) => rememberNote(note, prev));
      const savedPaise = paise;
      reset();
      setLastAddedPaise(savedPaise);
      setAddedCount((c) => c + 1);
      setJustAdded(true);
      toast.info("Saved offline — it'll sync when you're back online", { duration: 6000 });
      return;
    }

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
      // A2 — uncategorized entries close the loop immediately: the toast
      // offers a one-tap jump to the ledger's uncategorized view.
      if (templateCategoryId === undefined) {
        toast.success("Transaction added", {
          duration: 6000,
          action: {
            label: "Categorize",
            onClick: () => router.push("/transactions?category=uncategorized"),
          },
        });
      } else {
        toast.success("Transaction added");
      }
      // §6.7 — warn when this expense pushed the month or its category over budget
      if (res.alert) toast.warning(budgetAlertMessage(res.alert));
      // §6.2 — remember the committed tag/note so repeat entries start filled in
      lastEntryRef.current = { tag, note };
      saveLastEntry(lastEntryRef.current);
      setRecentNotes((prev) => rememberNote(note, prev));
      // Multi-entry — reset the form but KEEP the sheet open; a confirmation
      // banner takes over the footer with Add-another / Done.
      const savedPaise = paise;
      reset();
      setLastAddedPaise(savedPaise);
      setAddedCount((c) => c + 1);
      setJustAdded(true);
    } else {
      emitLedgerMutation({ kind: "create-revert", tempId });
      toast.error(res.error ?? "Could not save");
    }
  }

  const canSubmit = paise > 0;

  function continueAdding() {
    setJustAdded(false);
    // straight back into the amount field for the next item
    document.getElementById("qa-amount")?.focus();
  }

  function done() {
    setJustAdded(false);
    setAddedCount(0);
    reset();
    onClose();
  }

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
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setJustAdded(false); setAddedCount(0); reset(); onClose(); } }}>
      <SheetContent side="bottom" className="mx-auto flex max-h-[92dvh] max-w-2xl flex-col rounded-t-2xl px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6" showCloseButton={false}>
        <div className="mx-auto mb-1 h-1.5 w-10 rounded-full bg-muted" />
        <div className="mb-1 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => (justAdded ? done() : void submit())}
            disabled={saving}
            className="rounded-full px-3"
          >
            {justAdded ? "Done" : "Add transaction"}
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
            onAmountChange={(v) => {
              // typing a new amount while the confirmation banner is showing
              // simply resumes the form — no need to tap "Add another" first
              setJustAdded(false);
              setAmount(v);
            }}
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
            {/* A3 — one-tap recent notes while the field is empty */}
            {recentNotes.length > 0 && !note && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {recentNotes.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setNote(n)}
                    className="max-w-full truncate rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted-foreground/10 hover:text-foreground"
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Amendment 20 — no category picker here. Categorize later in the
              Ledger: tap a row to edit, or select many and assign at once. */}
        </div>

        <div className="border-t border-muted-foreground/10 pt-3">
          {error && <p className="mb-2 text-sm font-medium text-destructive">{error}</p>}
          {justAdded ? (
            /* Multi-entry confirmation — the form above is already reset and
               live again; typing an amount also dismisses this banner. */
            <div className="space-y-2">
              <p
                className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/10 py-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400"
                role="status"
              >
                <Check className="h-4 w-4" />
                Added {formatINRWhole(lastAddedPaise)}
                {addedCount > 1 ? ` · ${addedCount} this trip` : ""}
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="h-12 flex-1 text-base" onClick={done}>
                  Done
                </Button>
                <Button type="button" className="h-12 flex-[1.6] text-base" onClick={continueAdding}>
                  Add another
                </Button>
              </div>
            </div>
          ) : (
            <>
              {!saving && (
                <p className="mb-1.5 text-center text-[11px] text-muted-foreground">
                  {canSubmit ? "press Enter ↵ to add" : "Enter an amount"}
                </p>
              )}
              <Button type="submit" className="h-12 w-full text-base" disabled={!canSubmit || saving}>
                {saving ? "Adding…" : canSubmit ? `Add ${formatINRWhole(paise)}` : "Add transaction"}
              </Button>
            </>
          )}
        </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
