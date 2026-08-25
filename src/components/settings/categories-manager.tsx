"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Check, FolderPlus, Plus, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createCategory,
  createCategoryGroup,
  moveCategoryToGroup,
  reorderCategoriesUnder,
  reorderCategoryGroups,
  updateCategory,
} from "@/actions/settings";
import { emitLedgerMutation } from "@/lib/events";
import { loadRecentCategoryIds } from "@/lib/category-recents";
import type { CategoryOption } from "@/components/quick-add/types";

/**
 * Two-level category manager. Groups render as sections (rename/reorder like
 * members); leaves render inside their group with a "move to group" select
 * for reparenting. New leaves are created INTO a group; new groups at the
 * bottom. Deletion is still not offered — history always keeps its category.
 */
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

  const groups = items.filter((c) => c.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
  const childrenOf = (id: string) =>
    items.filter((c) => c.parentId === id).sort((a, b) => a.sortOrder - b.sortOrder);

  function patch(id: string, field: "name" | "emoji", value: string) {
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  }

  async function save(item: CategoryOption) {
    const res = await updateCategory({
      id: item.id,
      name: item.name.trim() || item.name,
      emoji: item.emoji || "📦",
      sortOrder: item.sortOrder,
    });
    if (res.ok) {
      toast.success("Saved");
      emitLedgerMutation({ kind: "refetch" });
      router.refresh();
    } else {
      toast.error(res.error ?? "Could not save");
    }
  }

  function moveGroup(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= groups.length) return;
    const next = groups.map((g) => g.id);
    [next[index], next[target]] = [next[target], next[index]];
    void reorderCategoryGroups(next).then(() => {
      toast.success("Group order saved");
      emitLedgerMutation({ kind: "refetch" });
      router.refresh();
    });
  }

  function moveWithin(group: CategoryOption, index: number, delta: number) {
    const kids = childrenOf(group.id);
    const target = index + delta;
    if (target < 0 || target >= kids.length) return;
    const next = kids.map((k) => k.id);
    [next[index], next[target]] = [next[target], next[index]];
    void reorderCategoriesUnder(group.id, next).then(() => {
      toast.success("Order saved");
      emitLedgerMutation({ kind: "refetch" });
      router.refresh();
    });
  }

  async function moveToGroup(categoryId: string, groupId: string) {
    const res = await moveCategoryToGroup({ categoryId, groupId });
    if (res.ok) {
      toast.success("Moved");
      emitLedgerMutation({ kind: "refetch" });
      router.refresh();
    } else {
      toast.error(res.error ?? "Could not move");
    }
  }

  return (
    <div className="space-y-4">
      {recentItems.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Recently created</p>
          <div className="flex flex-wrap gap-1.5">
            {recentItems.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  document.getElementById(`cat-${c.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors hover:bg-accent"
                style={{ borderColor: c.color }}
              >
                {c.name}
                <span className="rounded-full bg-primary px-1.5 py-px text-[9px] font-semibold text-primary-foreground">NEW</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {groups.map((g, gi) => (
        <section key={g.id} className="rounded-xl border p-3" style={{ borderColor: `${g.color}55` }}>
          {/* group header — rename + reorder among groups */}
          <div className="flex items-center gap-2">
            <Input
              aria-label="Group emoji"
              className="h-8 w-11 shrink-0 px-1 text-center text-base"
              value={g.emoji}
              maxLength={4}
              onChange={(e) => patch(g.id, "emoji", e.target.value)}
            />
            <Input
              aria-label="Group name"
              className="h-8 min-w-0 flex-1 text-sm font-semibold"
              value={g.name}
              maxLength={50}
              onChange={(e) => patch(g.id, "name", e.target.value)}
            />
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => moveGroup(gi, -1)} disabled={gi === 0} aria-label={`Move ${g.name} up`}>
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => moveGroup(gi, 1)} disabled={gi === groups.length - 1} aria-label={`Move ${g.name} down`}>
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => void save(g)} aria-label={`Save ${g.name}`}>
              <Save className="h-4 w-4" />
            </Button>
          </div>

          <ul className="mt-2 space-y-2 pl-4">
            {childrenOf(g.id).map((c, ci) => (
              <li key={c.id} id={`cat-${c.id}`} className="flex items-center gap-2">
                <Input
                  aria-label="Category name"
                  className="h-9 min-w-0 flex-1"
                  value={c.name}
                  onChange={(e) => patch(c.id, "name", e.target.value)}
                />
                <Input
                  aria-label="Category emoji"
                  className="h-9 w-11 shrink-0 px-1 text-center text-base"
                  value={c.emoji}
                  maxLength={4}
                  onChange={(e) => patch(c.id, "emoji", e.target.value)}
                />
                <Select value={c.parentId ?? ""} onValueChange={(v) => v !== c.parentId && void moveToGroup(c.id, v)}>
                  <SelectTrigger aria-label={`Move ${c.name} to another group`} className="h-9 w-[9.5rem] shrink-0 text-xs">
                    <SelectValue placeholder="Group…" />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((target) => (
                      <SelectItem key={target.id} value={target.id}>
                        {target.emoji} {target.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => moveWithin(g, ci, -1)} disabled={ci === 0} aria-label={`Move ${c.name} up`}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => moveWithin(g, ci, 1)} disabled={ci === childrenOf(g.id).length - 1} aria-label={`Move ${c.name} down`}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => void save(c)} aria-label={`Save ${c.name}`}>
                    <Save className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}

            {/* inline add-leaf-into-this-group */}
            <AddRow
              label={`Add to ${g.name}`}
              onSubmit={async (name, emoji) => {
                const res = await createCategory({ name, emoji, parentId: g.id });
                if (!res.ok) {
                  toast.error(res.error ?? "Could not add");
                  return false;
                }
                emitLedgerMutation({ kind: "refetch" });
                router.refresh();
                return true;
              }}
            />
          </ul>
        </section>
      ))}

      {/* new top-level group */}
      <AddRow
        icon={<FolderPlus className="mr-1 h-3.5 w-3.5" />}
        label="New group"
        defaultEmoji="🧺"
        submitLabel="Create group"
        onSubmit={async (name, emoji) => {
          const res = await createCategoryGroup({ name, emoji });
          if (!res.ok) {
            toast.error(res.error ?? "Could not create group");
            return false;
          }
          emitLedgerMutation({ kind: "refetch" });
          router.refresh();
          return true;
        }}
      />

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Groups hold their categories together across the picker, ledger filter and dashboard pie. Only
        categories (not groups) can be picked for transactions. Deletion is not available — history always
        keeps its category.
      </p>
    </div>
  );
}

/** Inline emoji+name creation row used for both new leaves and new groups. */
function AddRow({
  label,
  defaultEmoji = "🏷️",
  submitLabel = "Add",
  icon,
  onSubmit,
}: {
  label: string;
  defaultEmoji?: string;
  submitLabel?: string;
  icon?: React.ReactNode;
  onSubmit: (name: string, emoji: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(defaultEmoji);
  const [saving, setSaving] = useState(false);

  if (!open) {
    return (
      <li>
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-1.5 text-[11px] text-muted-foreground" onClick={() => setOpen(true)}>
          {icon ?? <Plus className="h-3.5 w-3.5" />} {label}
        </Button>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-1 rounded-lg border border-dashed p-2">
      <div className="flex gap-1">
        <Input
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
          className="h-8 w-10 shrink-0 px-1 text-center text-base"
          aria-label={`${label} emoji`}
          maxLength={4}
        />
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          className="h-8 min-w-0 flex-1 text-center text-xs"
          aria-label={`${label} name`}
          placeholder={label}
          maxLength={50}
        />
      </div>
      <div className="flex justify-center gap-1">
        <Button
          type="button"
          size="icon"
          className="h-6 w-6"
          disabled={saving || !name.trim()}
          onClick={() => {
            setSaving(true);
            void onSubmit(name.trim(), emoji || defaultEmoji).then((ok) => {
              setSaving(false);
              if (ok) {
                setName("");
                setEmoji(defaultEmoji);
                setOpen(false);
              }
            });
          }}
          aria-label={submitLabel}
        >
          <Check className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="h-6 w-6" disabled={saving} onClick={() => setOpen(false)} aria-label="Cancel">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}
