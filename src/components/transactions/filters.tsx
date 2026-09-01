"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, X, Pencil, Check, Calendar, Bookmark, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TRANSACTION_TAG_LABELS, TRANSACTION_TAGS } from "@/lib/constants";
import { buildLedgerUrl, UNCATEGORIZED, type LedgerFilters } from "@/lib/ledger-url";
import { updateCategory } from "@/actions/settings";
import { saveSearch, deleteSavedSearch } from "@/actions/saved-searches";
import { emitLedgerMutation } from "@/lib/events";
import type { CategoryOption, MemberOption } from "@/components/quick-add/types";
import { cn } from "@/lib/utils";

/** A saved search preset (§2.7) — name + the serialized filter params. */
export interface SavedSearchLite {
  id: string;
  name: string;
  params: LedgerFilters;
}

function pill(active: boolean) {
  return cn(
    "h-8 shrink-0 rounded-full px-3 text-xs font-medium transition-colors",
    active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted-foreground/10",
  );
}

export function FiltersBar({
  members,
  categories,
  filters,
  savedSearches = [],
}: {
  members: MemberOption[];
  categories: CategoryOption[];
  filters: LedgerFilters;
  /** §2.7 — saved presets to render as one-tap chips. */
  savedSearches?: SavedSearchLite[];
}) {
  const router = useRouter();
  const [q, setQ] = useState(filters.q ?? "");
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [renameEmoji, setRenameEmoji] = useState("");
  // UX pass — custom date-range picker
  const [rangeOpen, setRangeOpen] = useState(false);
  const [fromDraft, setFromDraft] = useState(filters.from ?? "");
  const [toDraft, setToDraft] = useState(filters.to ?? "");
  // §2.7 — amount-range bounds (user-facing rupees strings)
  const [amountMinDraft, setAmountMinDraft] = useState(filters.amountMin ?? "");
  const [amountMaxDraft, setAmountMaxDraft] = useState(filters.amountMax ?? "");
  // §2.7 — save-search affordance
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [savingSearch, setSavingSearch] = useState(false);
  const [saved, setSaved] = useState<SavedSearchLite[]>(savedSearches);

  const selectedCat = categories.find((c) => c.id === filters.categoryId);
  const selectedGroup = categories.find((c) => c.id === filters.groupId && c.parentId === null);
  const selectedMemberChip = members.find((m) => m.id === filters.memberId);

  // Two-level taxonomy — groups with their leaves, ordered by sortOrder.
  const groupRows = [...categories].filter((c) => c.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
  const childrenOf = (id: string) =>
    categories.filter((c) => c.parentId === id).sort((a, b) => a.sortOrder - b.sortOrder);

  // The last q this component pushed into the URL. The URL-sync effect below
  // ignores values that match it, so an in-flight navigation landing mid-typing
  // (its payload still carries the older query) can never clobber newer local
  // input — the "first character deletes itself" race. Only an external URL
  // change (deep link, Clear all) differs from the ref and syncs the field.
  const pushedQRef = useRef(filters.q ?? "");

  useEffect(() => {
    const urlQ = filters.q ?? "";
    if (urlQ !== pushedQRef.current) {
      pushedQRef.current = urlQ;
      setQ(urlQ);
    }
  }, [filters.q]);

  // keep drafts in sync when the URL changes externally
  useEffect(() => {
    setFromDraft(filters.from ?? "");
    setToDraft(filters.to ?? "");
  }, [filters.from, filters.to]);

  useEffect(() => {
    setAmountMinDraft(filters.amountMin ?? "");
    setAmountMaxDraft(filters.amountMax ?? "");
  }, [filters.amountMin, filters.amountMax]);

  // keep the local saved-searches list in sync if the prop changes
  useEffect(() => {
    setSaved(savedSearches);
  }, [savedSearches]);

  function applyRange() {
    setRangeOpen(false);
    push({
      ...filters,
      from: fromDraft || undefined,
      to: toDraft || undefined,
      amountMin: amountMinDraft || undefined,
      amountMax: amountMaxDraft || undefined,
    });
  }

  function clearRange() {
    setFromDraft("");
    setToDraft("");
    setAmountMinDraft("");
    setAmountMaxDraft("");
    setRangeOpen(false);
    push({ ...filters, from: undefined, to: undefined, amountMin: undefined, amountMax: undefined });
  }

  // §2.7 — copy the current filter combination as a shareable URL.
  async function copyLink() {
    const url = `${window.location.origin}${buildLedgerUrl(filters)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied — share this filtered view");
    } catch {
      toast.error("Could not copy link");
    }
  }

  // §2.7 — persist the current query (minus month, so it stays reusable) as a
  // named preset.
  async function saveCurrent() {
    const name = saveName.trim();
    if (!name) {
      toast.error("Give the search a name");
      return;
    }
    setSavingSearch(true);
    const res = await saveSearch(name, { ...filters, month: undefined });
    setSavingSearch(false);
    if (res.ok) {
      toast.success("Search saved");
      setSaved((cur) => [...cur, { id: res.id, name, params: { ...filters, month: undefined } }]);
      setSaveName("");
      setSaveOpen(false);
    } else {
      toast.error(res.error ?? "Could not save search");
    }
  }

  async function removeSaved(id: string) {
    const res = await deleteSavedSearch(id);
    if (res.ok) setSaved((cur) => cur.filter((s) => s.id !== id));
    else toast.error(res.error ?? "Could not delete search");
  }

  // changing the filtered category mid-rename would target the wrong row
  useEffect(() => {
    setRenaming(false);
  }, [filters.categoryId]);

  function push(next: LedgerFilters) {
    router.push(buildLedgerUrl(next));
  }

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      if (q !== (filters.q ?? "")) {
        pushedQRef.current = q;
        push({ ...filters, q });
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function startRename() {
    if (!selectedCat) return;
    setRenameEmoji(selectedCat.emoji);
    setRenameName(selectedCat.name);
    setRenaming(true);
  }

  function cancelRename() {
    setRenaming(false);
    setRenameName("");
    setRenameEmoji("");
  }

  async function saveRename() {
    if (!selectedCat || renaming) return;
    const name = renameName.trim();
    const emoji = renameEmoji.trim();
    if ((!name || name === selectedCat.name) && emoji === selectedCat.emoji) {
      cancelRename();
      return;
    }
    setRenaming(true);
    const res = await updateCategory({
      id: selectedCat.id,
      name: name || selectedCat.name,
      emoji: emoji || selectedCat.emoji,
      sortOrder: selectedCat.sortOrder,
    });
    setRenaming(false);
    if (res.ok) {
      toast.success("Category updated");
      emitLedgerMutation({ kind: "refetch" });
      router.refresh();
      cancelRename();
    } else {
      toast.error(res.error ?? "Could not update");
    }
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search notes…"
          className="h-9 pl-9 pr-8"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {q && (
          <button
            type="button"
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            onClick={() => setQ("")}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Layout pass — one scrollable row carries ALL filter families
          (members · tags · category); previously members and tags+category
          each had their own row. Active-filter chips render only when
          something is actually set. */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {members.map((m) => (
          <button
            key={m.id}
            type="button"
            className={pill(filters.memberId === m.id)}
            onClick={() => push({ ...filters, memberId: filters.memberId === m.id ? undefined : m.id })}
          >
            {m.emoji} {m.name}
          </button>
        ))}
        <span aria-hidden className="h-5 w-px shrink-0 bg-muted-foreground/20" />
        {TRANSACTION_TAGS.map((t) => (
          <button
            key={t}
            type="button"
            className={pill(filters.tag === t)}
            onClick={() => push({ ...filters, tag: filters.tag === t ? undefined : t })}
          >
            {TRANSACTION_TAG_LABELS[t]}
          </button>
        ))}
        <span aria-hidden className="h-5 w-px shrink-0 bg-muted-foreground/20" />
        {/* Two-level category filter — groups as labelled sections, leaves
            nested under each. Values carry a g:/c: prefix so the change
            handler knows which filter slot to write; picking any of the
            three (leaf / group / uncategorized) clears the others. */}
        <Select
          value={
            filters.uncategorized
              ? UNCATEGORIZED
              : filters.categoryId
                ? `c:${filters.categoryId}`
                : filters.groupId
                  ? `g:${filters.groupId}`
                  : ""
          }
          onValueChange={(v) => {
            if (v === "") push({ ...filters, categoryId: undefined, groupId: undefined, uncategorized: undefined });
            else if (v === UNCATEGORIZED) push({ ...filters, categoryId: undefined, groupId: undefined, uncategorized: true });
            else if (v.startsWith("g:")) push({ ...filters, categoryId: undefined, groupId: v.slice(2), uncategorized: undefined });
            else push({ ...filters, categoryId: v.slice(2), groupId: undefined, uncategorized: undefined });
          }}
        >
          <SelectTrigger className="h-8 w-36 shrink-0 text-xs">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All categories</SelectItem>
            {/* Amendment 20 — rows with no category assigned */}
            <SelectItem value={UNCATEGORIZED}>❔ Uncategorized</SelectItem>
            {groupRows.map((g) => (
              <SelectGroup key={g.id}>
                <SelectLabel className="text-[11px] font-semibold text-muted-foreground">
                  {g.emoji} {g.name}
                </SelectLabel>
                {/* The group itself is selectable (?group=<uuid>) — matches
                    every leaf under it; picking any leaf narrows to just that
                    leaf, and the three values stay mutually exclusive. */}
                <SelectItem value={`g:${g.id}`} className="text-xs font-medium">
                  {g.emoji} {g.name} — all
                </SelectItem>
                {childrenOf(g.id).map((c) => (
                  <SelectItem key={c.id} value={`c:${c.id}`} className="pl-6 text-xs">
                    {c.emoji} {c.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <span aria-hidden className="h-5 w-px shrink-0 bg-muted-foreground/20" />
        {/* UX pass — custom date range + amount range entry point (§2.7) */}
        <button
          type="button"
          className={pill(!!(filters.from || filters.to || filters.amountMin || filters.amountMax))}
          onClick={() => setRangeOpen((v) => !v)}
        >
          <Calendar className="mr-0.5 inline h-3 w-3" />
          {filters.from || filters.to || filters.amountMin || filters.amountMax ? "Range" : "Dates"}
        </button>
        {/* §2.7 — share the current filter combination as a URL */}
        <button type="button" className={pill(false)} onClick={() => void copyLink()} aria-label="Copy shareable link">
          <Link2 className="mr-0.5 inline h-3 w-3" />
          Share
        </button>
        {/* §2.7 — save the current query as a named preset */}
        <button type="button" className={pill(saveOpen)} onClick={() => setSaveOpen((v) => !v)} aria-label="Save this search">
          <Bookmark className="mr-0.5 inline h-3 w-3" />
          Save
        </button>
      </div>

      {/* date-range panel */}
      {rangeOpen && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-muted-foreground/20 bg-muted p-2">
          <Input
            aria-label="From date"
            type="date"
            value={fromDraft}
            max={toDraft || undefined}
            onChange={(e) => setFromDraft(e.target.value)}
            className="h-8 w-36 text-xs"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            aria-label="To date"
            type="date"
            value={toDraft}
            min={fromDraft || undefined}
            onChange={(e) => setToDraft(e.target.value)}
            className="h-8 w-36 text-xs"
          />
          <Button size="sm" className="h-8 rounded-full px-3 text-xs" onClick={applyRange}>
            <Check className="mr-1 h-3.5 w-3.5" /> Apply
          </Button>
          {(filters.from || filters.to || filters.amountMin || filters.amountMax) && (
            <Button size="sm" variant="ghost" className="h-8 rounded-full px-3 text-xs" onClick={clearRange}>
              Clear
            </Button>
          )}
        </div>
      )}

      {/* §2.7 — amount-range panel (revealed by the same "Range" toggle) */}
      {rangeOpen && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-muted-foreground/20 bg-muted p-2">
          <span className="text-xs font-medium text-muted-foreground">Amount ₹</span>
          <Input
            aria-label="Minimum amount"
            type="number"
            min={0}
            inputMode="decimal"
            placeholder="min"
            value={amountMinDraft}
            onChange={(e) => setAmountMinDraft(e.target.value)}
            className="h-8 w-24 text-xs"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            aria-label="Maximum amount"
            type="number"
            min={0}
            inputMode="decimal"
            placeholder="max"
            value={amountMaxDraft}
            onChange={(e) => setAmountMaxDraft(e.target.value)}
            className="h-8 w-24 text-xs"
          />
          <span className="text-[11px] text-muted-foreground">per transaction</span>
        </div>
      )}

      {/* §2.7 — inline save-search name prompt */}
      {saveOpen && (
        <div className="flex items-center gap-1.5 rounded-lg border border-muted-foreground/20 bg-muted p-1.5">
          <Input
            aria-label="Search name"
            autoFocus
            className="h-8 min-w-0 flex-1"
            placeholder="Name this search (e.g. Big fuel spends)"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveCurrent();
              if (e.key === "Escape") setSaveOpen(false);
            }}
            maxLength={40}
          />
          <Button size="sm" className="h-8 rounded-full px-3 text-xs" disabled={savingSearch} onClick={() => void saveCurrent()}>
            <Bookmark className="mr-1 h-3.5 w-3.5" /> Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 rounded-full px-3 text-xs"
            onClick={() => setSaveOpen(false)}
            aria-label="Cancel save"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* §2.7 — saved search presets as one-tap chips */}
      {saved.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Saved</span>
          {saved.map((s) => (
            <span key={s.id} className={cn(pill(false), "flex items-center gap-1")}>
              <button type="button" className="flex items-center gap-1" onClick={() => push(s.params)}>
                <Bookmark className="inline h-3 w-3" />
                {s.name}
              </button>
              <button
                type="button"
                aria-label={`Delete saved search ${s.name}`}
                className="ml-1 inline-flex text-muted-foreground hover:text-foreground"
                onClick={() => void removeSaved(s.id)}
              >
                <X className="inline h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* active-filter chips — only rendered while something is set */}
      {(filters.memberId || filters.tag || filters.categoryId || filters.groupId || filters.uncategorized || filters.from || filters.to || filters.amountMin || filters.amountMax || filters.q?.trim()) && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Active</span>
          {selectedMemberChip && (
            <button type="button" className={pill(false)} onClick={() => push({ ...filters, memberId: undefined })}>
              {selectedMemberChip.emoji} {selectedMemberChip.name} <X className="ml-0.5 inline h-3 w-3" />
            </button>
          )}
          {filters.tag && (
            <button type="button" className={pill(false)} onClick={() => push({ ...filters, tag: undefined })}>
              {TRANSACTION_TAG_LABELS[filters.tag]} <X className="ml-0.5 inline h-3 w-3" />
            </button>
          )}
          {filters.uncategorized && (
            <button type="button" className={cn(pill(false), "text-amber-700 dark:text-amber-400")} onClick={() => push({ ...filters, uncategorized: undefined })}>
              ❔ Uncategorized <X className="ml-0.5 inline h-3 w-3" />
            </button>
          )}
          {filters.groupId && selectedGroup && (
            <span className={cn(pill(true), "max-w-44")}>
              {selectedGroup.emoji} {selectedGroup.name} · group
              <button
                type="button"
                aria-label={`Clear ${selectedGroup.name} filter`}
                onClick={() => push({ ...filters, groupId: undefined })}
                className="ml-1 inline-flex"
              >
                <X className="inline h-3 w-3" />
              </button>
            </span>
          )}
          {(filters.from || filters.to) && (
            <button type="button" className={pill(false)} onClick={clearRange}>
              <Calendar className="mr-0.5 inline h-3 w-3" />
              {filters.from ?? "…"} – {filters.to ?? "…"} <X className="ml-0.5 inline h-3 w-3" />
            </button>
          )}
          {(filters.amountMin || filters.amountMax) && (
            <button type="button" className={pill(false)} onClick={clearRange}>
              ₹{filters.amountMin || "0"}–{filters.amountMax || "∞"} <X className="ml-0.5 inline h-3 w-3" />
            </button>
          )}
          {filters.categoryId && selectedCat && !renaming && (
            <>
              <span className={cn(pill(true), "max-w-44")}>
                {selectedCat.emoji} {selectedCat.name}
                <button
                  type="button"
                  aria-label={`Clear ${selectedCat.name} filter`}
                  onClick={() => push({ ...filters, categoryId: undefined })}
                  className="ml-1 inline-flex"
                >
                  <X className="inline h-3 w-3" />
                </button>
              </span>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground" onClick={startRename} aria-label={`Rename ${selectedCat.name}`}>
                <Pencil className="h-4 w-4" />
              </Button>
            </>
          )}
          {filters.categoryId && !selectedCat && (
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground" onClick={() => push({ ...filters, categoryId: undefined })} aria-label="Clear category">
              <X className="h-4 w-4" />
            </Button>
          )}
          <button type="button" className={cn(pill(false), "ml-auto")} onClick={() => { setQ(""); push({}); }}>
            Clear all
          </button>
        </div>
      )}

      {renaming && selectedCat && (
        <div className="flex items-center gap-1.5 rounded-lg border border-muted-foreground/20 bg-muted p-1.5">
          <Input
            aria-label="Category emoji"
            className="h-8 w-11 shrink-0 text-center text-base"
            value={renameEmoji}
            onChange={(e) => setRenameEmoji(e.target.value)}
            maxLength={4}
          />
          <Input
            aria-label="Category name"
            autoFocus
            className="h-8 min-w-0 flex-1"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveRename();
              if (e.key === "Escape") cancelRename();
            }}
            maxLength={50}
          />
          <Button size="icon" className="h-8 w-8 shrink-0" onClick={() => void saveRename()} aria-label="Save rename">
            <Check className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={cancelRename} aria-label="Cancel rename">
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
