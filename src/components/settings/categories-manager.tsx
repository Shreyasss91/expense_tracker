"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateCategory, reorderCategories } from "@/actions/settings";
import { emitLedgerMutation } from "@/lib/events";
import { loadRecentCategoryIds } from "@/lib/category-recents";
import type { CategoryOption } from "@/components/quick-add/types";

export function CategoriesManager({ categories }: { categories: CategoryOption[] }) {
  const router = useRouter();
  const [items, setItems] = useState(categories);
  // §6.5 — live-sync when the server-side category set changes (e.g. a category
  // created inline from Quick Add), so the list updates without a remount; the
  // id-set guard leaves in-progress name/emoji edits untouched.
  const syncedIdsRef = useRef(categories.map((c) => c.id).sort().join(","));
  useEffect(() => {
    const ids = categories.map((c) => c.id).sort().join(",");
    if (ids !== syncedIdsRef.current) {
      syncedIdsRef.current = ids;
      setItems(categories);
    }
  }, [categories]);
  // §6.5 — "Recently created" strip: ids recorded client-side when a category is
  // created inline (Quick Add / edit dialog), hydrated after mount.
  const [recentIds, setRecentIds] = useState<string[]>([]);
  useEffect(() => {
    setRecentIds(loadRecentCategoryIds());
  }, []);
  const recentItems = recentIds
    .map((id) => items.find((c) => c.id === id))
    .filter((c): c is CategoryOption => Boolean(c));

  function move(index: number, delta: number) {
    const next = [...items];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    void reorderCategories(next.map((c) => c.id)).then(() => {
      toast.success("Order saved");
      emitLedgerMutation({ kind: "refetch" });
      router.refresh();
    });
  }

  async function save(index: number) {
    const item = items[index];
    const res = await updateCategory({
      id: item.id,
      name: item.name.trim() || item.name,
      emoji: item.emoji.trim() || "📦",
      sortOrder: index + 1,
    });
    if (res.ok) {
      toast.success("Saved");
      emitLedgerMutation({ kind: "refetch" });
      router.refresh();
    } else {
      toast.error(res.error ?? "Could not save");
    }
  }

  function patch(index: number, field: "name" | "emoji", value: string) {
    setItems((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  }

  return (
    <>
      {recentItems.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Recently created</p>
          <div className="flex flex-wrap gap-1.5">
            {recentItems.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  document.getElementById(`cat-${c.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors hover:bg-accent"
                style={{ borderColor: c.color }}
              >
                <span>{c.emoji}</span>
                {c.name}
                <span className="rounded-full bg-primary px-1.5 py-px text-[9px] font-semibold text-primary-foreground">NEW</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <ul className="space-y-2">
      {items.map((c, i) => (
        <li key={c.id} id={`cat-${c.id}`} className="flex items-center gap-2">
          <Input
            aria-label="Emoji"
            className="h-9 w-12 text-center text-base"
            value={c.emoji}
            onChange={(e) => patch(i, "emoji", e.target.value)}
          />
          <Input
            aria-label="Category name"
            className="h-9 flex-1"
            value={c.name}
            onChange={(e) => patch(i, "name", e.target.value)}
          />
          <div className="flex shrink-0 items-center gap-0.5">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Move down">
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => save(i)} aria-label="Save">
              <Save className="h-4 w-4" />
            </Button>
          </div>
        </li>
      ))}
      </ul>
    </>
  );
}
