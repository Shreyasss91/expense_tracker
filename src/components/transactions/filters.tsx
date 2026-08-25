"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, X, Pencil, Check, Calendar } from "lucide-react";
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
import { emitLedgerMutation } from "@/lib/events";
import type { CategoryOption, MemberOption } from "@/components/quick-add/types";
import { cn } from "@/lib/utils";

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
}: {
  members: MemberOption[];
  categories: CategoryOption[];
  filters: LedgerFilters;
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

  function applyRange() {
    setRangeOpen(false);
    push({ ...filters, from: fromDraft || undefined, to: toDraft || undefined });
  }

  function clearRange() {
    setFromDraft("");
    setToDraft("");
    setRangeOpen(false);
    push({ ...filters, from: undefined, to: undefined });
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
        {/* UX pass — custom date range entry point */}
        <button
          type="button"
          className={pill(!!(filters.from || filters.to))}
          onClick={() => setRangeOpen((v) => !v)}
        >
          <Calendar className="mr-0.5 inline h-3 w-3" />
          {filters.from || filters.to ? "Range" : "Dates"}
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
          {(filters.from || filters.to) && (
            <Button size="sm" variant="ghost" className="h-8 rounded-full px-3 text-xs" onClick={clearRange}>
              Clear
            </Button>
          )}
        </div>
      )}

      {/* active-filter chips — only rendered while something is set */}
      {(filters.memberId || filters.tag || filters.categoryId || filters.groupId || filters.uncategorized || filters.from || filters.to || filters.q?.trim()) && (
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
          {filters.categoryId && selectedCat && !renaming && (
            <>
              <span className={cn(pill(true), "max-w-44")}>
                {selectedCat.emoji} {selectedCat.name} <X className="ml-0.5 inline h-3 w-3" />
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
