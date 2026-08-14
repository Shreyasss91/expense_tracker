"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TRANSACTION_TAG_LABELS, TRANSACTION_TAGS } from "@/lib/constants";
import type { CategoryOption, MemberOption } from "@/components/quick-add/types";
import { cn } from "@/lib/utils";

export interface LedgerFilters {
  memberId?: string;
  categoryId?: string;
  tag?: "one_time" | "recurring" | "lifestyle";
  month?: string;
  q?: string;
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
}: {
  members: MemberOption[];
  categories: CategoryOption[];
  filters: LedgerFilters;
}) {
  const router = useRouter();
  const [q, setQ] = useState(filters.q ?? "");

  useEffect(() => {
    setQ(filters.q ?? "");
  }, [filters.q]);

  function push(next: LedgerFilters) {
    const params = new URLSearchParams();
    if (next.memberId) params.set("member", next.memberId);
    if (next.categoryId) params.set("category", next.categoryId);
    if (next.tag) params.set("tag", next.tag);
    if (next.month) params.set("month", next.month);
    if (next.q?.trim()) params.set("q", next.q.trim());
    const qs = params.toString();
    router.push(qs ? `/transactions?${qs}` : "/transactions");
  }

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      if (q !== (filters.q ?? "")) push({ ...filters, q });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const hasFilters = !!(filters.memberId || filters.categoryId || filters.tag || filters.month || filters.q);

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
        <Select value={filters.month ?? ""} onValueChange={(v) => push({ ...filters, month: v || undefined })}>
          <SelectTrigger className="h-8 w-32 shrink-0 text-xs">
            <SelectValue placeholder="All months" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All months</SelectItem>
            {Array.from({ length: 60 }, (_, i) => {
              const d = new Date();
              d.setMonth(d.getMonth() - i);
              const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
              return (
                <SelectItem key={v} value={v}>
                  {d.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
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
        {hasFilters && (
          <button type="button" className={pill(false)} onClick={() => push({})}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
