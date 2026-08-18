"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { createTransaction } from "@/actions/transactions";
import { getCategoryBudgetStatus, updateCategory } from "@/actions/settings";
import { emitLedgerMutation } from "@/lib/events";
import { useCategoryUsage } from "@/lib/category-usage";
import { suggestCategories } from "@/lib/category-suggestions";
import { useCreateCategory } from "@/lib/use-create-category";
import { paiseToDbString } from "@/lib/money";
import { budgetAlertMessage } from "@/lib/budget-alert";
import { formatInTimeZone } from "date-fns-tz";
import { APP_TIMEZONE, TRANSACTION_TAGS } from "@/lib/constants";
import type { TransactionListRow } from "@/lib/query";
import type { CategoryOption, MemberOption } from "./types";
import { AmountField, CategoryGrid, DateTimeField, TagSelector, type TransactionTag } from "@/components/transactions/transaction-fields";

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

// §6.2 — the Date/Time row's collapsed/expanded choice persists per device, so a
// user who expands the pickers once keeps them expanded on later visits.
const DATE_TIME_EXPANDED_KEY = "quick-add:date-time-expanded";

function loadDateTimeExpanded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DATE_TIME_EXPANDED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveDateTimeExpanded(expanded: boolean) {
  try {
    window.localStorage.setItem(DATE_TIME_EXPANDED_KEY, expanded ? "1" : "0");
  } catch {
    // storage unavailable — remembering is best-effort
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
  // the date/time pickers stay collapsed behind their defaults until tapped;
  // the choice persists across sessions (dateTimeExpandedRef is the hydrated copy)
  const [showDatePicker, setShowDatePicker] = useState(false);
  const dateTimeExpandedRef = useRef(false);
  const [editMode, setEditMode] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameEmoji, setRenameEmoji] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [cats, setCats] = useState(categories);
  // §6.7 — remaining budget per category for the current date's month (expense only)
  const [budgetRemaining, setBudgetRemaining] = useState<Map<string, number> | null>(null);
  // §6.2 — the last committed tag + note, restored on open and updated on save
  const lastEntryRef = useRef<{ tag: TransactionTag; note: string }>({ tag: "lifestyle", note: "" });
  const router = useRouter();

  // Hydrate the remembered tag/note and the date/time collapsed choice after mount
  // (never during SSR, so the server-rendered defaults stay consistent with the
  // client's first paint).
  useEffect(() => {
    lastEntryRef.current = loadLastEntry();
    setTag(lastEntryRef.current.tag);
    setNote(lastEntryRef.current.note);
    dateTimeExpandedRef.current = loadDateTimeExpanded();
    setShowDatePicker(dateTimeExpandedRef.current);
  }, []);

  // Keep the local category copy in sync with server-provided data when not mid-edit,
  // so renames done elsewhere (Settings) also land in this picker.
  useEffect(() => {
    if (!editMode && !renamingId) setCats(categories);
  }, [categories, editMode, renamingId]);

  const paise = useMemo(() => Math.round(parseFloat(amount || "0") * 100) || 0, [amount]);
  const activeMember = members.find((m) => m.id === activeMemberId) ?? members[0];
  // §6.2 — recently used categories float to the top of the grid
  const { orderedCategories, touchCategory } = useCategoryUsage(cats);

  // §6.2 — when a note is typed, show up to 6 suggested categories instead of the
  // full grid; fall back to the full grid when nothing matches. The already
  // selected category stays pinned at the top so the selection never vanishes.
  const noteTrimmed = note.trim();
  const { shownCategories, suggestionsActive } = useMemo(() => {
    if (editMode || !noteTrimmed) return { shownCategories: orderedCategories, suggestionsActive: false };
    const suggestions = suggestCategories(noteTrimmed, orderedCategories);
    if (suggestions.length === 0) return { shownCategories: orderedCategories, suggestionsActive: false };
    if (selectedCategoryId && !suggestions.some((c) => c.id === selectedCategoryId)) {
      const selected = orderedCategories.find((c) => c.id === selectedCategoryId);
      if (selected) return { shownCategories: [selected, ...suggestions], suggestionsActive: true };
    }
    return { shownCategories: suggestions, suggestionsActive: true };
  }, [noteTrimmed, orderedCategories, editMode, selectedCategoryId]);

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
    setShowDatePicker(dateTimeExpandedRef.current);
    cancelAddCategory();
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
            onTogglePicker={() => {
              const next = !showDatePicker;
              dateTimeExpandedRef.current = next;
              saveDateTimeExpanded(next);
              setShowDatePicker(next);
            }}
          />

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
            categories={shownCategories}
            selectedId={selectedCategoryId}
            onSelect={setSelectedCategoryId}
            budgetRemaining={budgetRemaining}
            showBudgetHints={!editMode}
            hint={
              suggestionsActive
                ? "Suggested from your note — tap to select"
                : "Tap a category to select it"
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
