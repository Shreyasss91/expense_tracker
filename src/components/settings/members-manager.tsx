"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateMember, reorderMembers } from "@/actions/settings";
import { emitLedgerMutation } from "@/lib/events";
import type { MemberOption } from "@/components/quick-add/types";

const PRESETS = [
  "#ef4444", "#f97316", "#f59e0b", "#22c55e", "#10b981", "#0ea5e9",
  "#3b82f6", "#6366f1", "#8b5cf6", "#d946ef", "#ec4899", "#64748b",
];

export function MembersManager({ members }: { members: MemberOption[] }) {
  const router = useRouter();
  const [items, setItems] = useState(members);

  function move(index: number, delta: number) {
    const next = [...items];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    void reorderMembers(next.map((m) => m.id)).then(() => {
      toast.success("Order saved");
      emitLedgerMutation({ kind: "refetch" });
      router.refresh();
    });
  }

  async function save(index: number) {
    const item = items[index];
    const res = await updateMember({
      id: item.id,
      name: item.name.trim() || item.name,
      emoji: item.emoji.trim() || "👤",
      color: /^#[0-9a-fA-F]{6}$/.test(item.color) ? item.color : PRESETS[index % PRESETS.length],
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

  function patch(index: number, field: "name" | "emoji" | "color", value: string) {
    setItems((prev) => prev.map((m, i) => (i === index ? { ...m, [field]: value } : m)));
  }

  return (
    <ul className="space-y-3">
      {items.map((m, i) => (
        <li key={m.id} className="space-y-2 rounded-lg border p-2.5">
          <div className="flex items-center gap-2">
            <Input
              aria-label="Emoji"
              className="h-9 w-12 text-center text-base"
              value={m.emoji}
              onChange={(e) => patch(i, "emoji", e.target.value)}
            />
            <Input
              aria-label="Member name"
              className="h-9 flex-1"
              value={m.name}
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
          </div>
          <div className="flex items-center gap-1.5 pl-1">
            {PRESETS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Colour ${color}`}
                // §3.4 — 44px hit area; the 24px swatch paints inside it.
                className={`m-0.5 h-9 w-9 rounded-full transition-transform ${m.color === color ? "ring-2 ring-ring ring-offset-2" : ""}`}
                style={{ background: color }}
                onClick={() => patch(i, "color", color)}
              />
            ))}
            <Input
              aria-label="Colour hex"
              className="ml-auto h-8 w-24 text-xs"
              value={m.color}
              onChange={(e) => patch(i, "color", e.target.value)}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
