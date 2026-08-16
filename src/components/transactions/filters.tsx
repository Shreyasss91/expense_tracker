"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, X, Pencil, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TRANSACTION_TAG_LABELS, TRANSACTION_TAGS } from "@/lib/constants";
import { buildLedgerUrl, type LedgerFilters } from "@/lib/ledger-url";
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

  const selectedCat = categories.find((c) => c.id === filters.categoryId);

  useEffect(() => {
    setQ(filters.q ?? "");
  }, [filters.q]);

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
      if (q !== (filters.q ?? "")) push({ ...filters, q });
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

  const hasFilters = !!(filters.memberId || filters.categoryId || filters.tag || filters.month || filters.type || filters.q);

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

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button type="button" className={pill(!filters.memberId)} onClick={() => push({ ...filters, memberId: undefined })}>
          All members
        </button>
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
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button type="button" className={pill(!filters.tag)} onClick={() => push({ ...filters, tag: undefined })}>
          All tags
        </button>
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
        <Select value={filters.categoryId ?? ""} onValueChange={(v) => push({ ...filters, categoryId: v || undefined })}>
          <SelectTrigger className="h-8 w-36 shrink-0 text-xs">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedCat && !renaming && (
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground" onClick={startRename} aria-label={`Rename ${selectedCat.name}`}>
            <Pencil className="h-4 w-4" />
          </Button>
        )}
        {hasFilters && (
          <button type="button" className={pill(false)} onClick={() => push({})}>
            Clear
          </button>
        )}
      </div>

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
