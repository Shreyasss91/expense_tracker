"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { getCategoryBudgetStatus, updateCategory } from "@/actions/settings";
import { updateActiveMember } from "@/actions/member";
import { emitLedgerMutation } from "@/lib/events";
import { useCategoryUsage } from "@/lib/category-usage";
import { suggestCategories } from "@/lib/category-suggestions";
import { useCreateCategory } from "@/lib/use-create-category";
import { formatINRWhole, paiseToDbString } from "@/lib/money";
import { budgetAlertMessage } from "@/lib/budget-alert";
import { formatInTimeZone } from "date-fns-tz";
import { APP_TIMEZONE, TRANSACTION_TAGS } from "@/lib/constants";
import type { TransactionListRow } from "@/lib/query";
import type { CategoryOption, MemberOption } from "./types";
import { AmountTagRow, CategoryGrid, DateTimeField, type TransactionTag } from "@/components/transactions/transaction-fields";

// §6.2 — repeat entries (recharges, EMIs, rent) start with the last committed
// tag + note already filled in; the amount, category, date and time never repeat.
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
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // the member chip doubles as a switcher (§1); optimistic against the cookie
  // written by updateActiveMember, reverted if the switch fails
  const [localActiveMemberId, setLocalActiveMemberId] = useState(activeMemberId);
  useEffect(() => {
    setLocalActiveMemberId(activeMemberId);
  }, [activeMemberId]);
  // Amendment 11 §2 — always starts collapsed with today's date/default time on
  // every open; no longer persisted, so it can't come back pre-expanded on a
  // device where it was toggled open before. Still toggleable within the
  // current session/tab (state lives on this always-mounted component).
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameEmoji, setRenameEmoji] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [cats, setCats] = useState(categories);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  // §6.7 — remaining budget per category for the current date's month (expense only)
  const [budgetRemaining, setBudgetRemaining] = useState<Map<string, number> | null>(null);
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

  // Keep the local category copy in sync with server-provided data when not mid-edit,
  // so renames done elsewhere (Settings) also land in this picker.
  useEffect(() => {
    if (!editMode && !renamingId) setCats(categories);
  }, [categories, editMode, renamingId]);

  // §6.9 — reset "show all" whenever the note changes so fresh input shows suggestions
  useEffect(() => {
    setShowAllSuggestions(false);
  }, [note]);

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
  // §6.2 — recently used categories float to the top of the grid
  const { orderedCategories, touchCategory } = useCategoryUsage(cats);

  // §6.2 — when a note is typed, show up to 6 suggested categories instead of the
  // full grid; fall back to the full grid when nothing matches. The already
  // selected category stays pinned at the top so the selection never vanishes.
  // §6.9 — "Show all" button lets the user expand suggestions to the full grid.
  const noteTrimmed = note.trim();
  const { shownCategories, suggestionsActive, hasMoreCategories } = useMemo(() => {
    if (editMode || !noteTrimmed)
      return { shownCategories: orderedCategories, suggestionsActive: false, hasMoreCategories: false };
    const suggestions = suggestCategories(noteTrimmed, orderedCategories);
    if (suggestions.length === 0)
      return { shownCategories: orderedCategories, suggestionsActive: false, hasMoreCategories: false };
    if (showAllSuggestions)
      return { shownCategories: orderedCategories, suggestionsActive: false, hasMoreCategories: false };
    const hasMore = suggestions.length < orderedCategories.length;
    if (selectedCategoryId && !suggestions.some((c) => c.id === selectedCategoryId)) {
      const selected = orderedCategories.find((c) => c.id === selectedCategoryId);
      if (selected)
        return { shownCategories: [selected, ...suggestions], suggestionsActive: true, hasMoreCategories: hasMore };
    }
    return { shownCategories: suggestions, suggestionsActive: true, hasMoreCategories: hasMore };
  }, [noteTrimmed, orderedCategories, editMode, selectedCategoryId, showAllSuggestions]);

  // §6.2 — inline "add a new category" flow (shared with the edit dialog)
  const { open: openAddCategory, cancel: cancelAddCategory, addForm } = useCreateCategory(
    useCallback((c: CategoryOption) => {
      setCats((list) => [...list, c]);
      setSelectedCategoryId(c.id);
    }, []),
  );

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
    setTag(lastEntryRef.current.tag);
    setSelectedCategoryId("");
    setNote(lastEntryRef.current.note);
    setError(null);
    setDate(formatInTimeZone(new Date(), APP_TIMEZONE, "yyyy-MM-dd"));
    setTime(formatInTimeZone(new Date(), APP_TIMEZONE, "HH:mm"));
    setEditMode(false);
    setRenamingId(null);
    setRenameValue("");
    setRenameEmoji("");
    setShowDatePicker(false);
    setShowAllSuggestions(false);
    setSubmitAttempted(false);
    cancelAddCategory();
  }

  async function submit() {
    if (paise <= 0 || saving) {
      setSubmitAttempted(true);
      return;
    }
    const member = members.find((m) => m.id === localActiveMemberId) ?? members[0];
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
      memberId: localActiveMemberId, // server reads the cookie anyway (§6.2)
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
      // §6.2 — remember the committed tag/note and category usage so repeat entries
      // start filled in and recently used categories float to the top of the grid
      lastEntryRef.current = { tag, note };
      saveLastEntry(lastEntryRef.current);
      touchCategory(category.id);
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
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="rounded text-base font-semibold underline-offset-2 hover:underline disabled:pointer-events-none disabled:opacity-60"
          >
            Add transaction
          </button>
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
              frequently edited fields (Amount → Tag → Note → Category) stay together;
              the pickers stay collapsed behind a summary until tapped */}
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

          <CategoryGrid
            categories={shownCategories}
            selectedId={selectedCategoryId}
            onSelect={setSelectedCategoryId}
            budgetRemaining={budgetRemaining}
            showBudgetHints={!editMode}
            hint={
              suggestionsActive
                ? "Suggested from your note — tap to select"
                : "Tap a category to select"
            }
            showAllLink={
              suggestionsActive && hasMoreCategories ? (
                <button
                  type="button"
                  onClick={() => setShowAllSuggestions(true)}
                  className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                >
                  Show all categories
                </button>
              ) : undefined
            }
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
            onAddCategory={openAddCategory}
            addForm={addForm}
          />
        </div>

        <div className="border-t border-muted-foreground/10 pt-3">
          {error && <p className="mb-2 text-sm font-medium text-destructive">{error}</p>}
          {!saving && (
            <p className="mb-1.5 text-center text-[11px] text-muted-foreground">
              {canSubmit
                ? "press Enter ↵ to add"
                : paise <= 0 && !selectedCategoryId
                  ? "Enter an amount and pick a category"
                  : paise <= 0
                    ? "Enter an amount"
                    : "Pick a category"}
            </p>
          )}
          <Button type="submit" className="h-12 w-full text-base" disabled={!canSubmit || saving}>
            {saving
              ? "Adding…"
              : canSubmit
                ? `Add ${formatINRWhole(paise)} · ${cats.find((c) => c.id === selectedCategoryId)?.name ?? ""}`
                : "Add transaction"}
          </Button>
        </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
