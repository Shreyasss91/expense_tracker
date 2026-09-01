"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Repeat, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createTemplate } from "@/actions/templates";
import { formatINR } from "@/lib/money";
import type { RecurringSuggestion } from "@/lib/recurring-detection";

/**
 * §2.4 — renders the mined recurring-bill suggestions as a one-tap "create a
 * template" prompt. Each card pre-fills a recurring template from the cluster
 * (canonical amount + category + note) so the user confirms rather than
 * re-types. A dismiss hides it locally; creating also revalidates the
 * template list. Suggestions whose source transactions are uncategorized
 * can't become a template (templates require a leaf category) so the button
 * is disabled with a hint.
 */
export function RecurringSuggestions({ suggestions }: { suggestions: RecurringSuggestion[] }) {
  const [items, setItems] = useState(suggestions);
  const [creating, setCreating] = useState<string | null>(null);

  if (items.length === 0) return null;

  async function handleCreate(s: RecurringSuggestion) {
    if (!s.categoryId) return;
    setCreating(s.key);
    const res = await createTemplate({
      name: (s.note ?? "").trim() || s.categoryName || "Recurring bill",
      categoryId: s.categoryId,
      tag: "recurring",
      amount: s.canonicalPaise,
      note: s.note ?? null,
    });
    setCreating(null);
    if (res.ok) {
      toast.success("Template created — you can automate it from Settings");
      setItems((cur) => cur.filter((x) => x.key !== s.key));
    } else {
      toast.error(res.error ?? "Could not create template");
    }
  }

  function dismiss(key: string) {
    setItems((cur) => cur.filter((x) => x.key !== key));
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Repeat className="size-4" /> Recurring suggestions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((s) => {
          const canCreate = Boolean(s.categoryId);
          return (
            <div key={s.key} className="flex items-center gap-2 rounded-lg border p-2.5">
              <span className="text-base" aria-hidden>
                {s.categoryEmoji ?? "🔁"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  <span className="font-medium tabular-nums text-red-600">{formatINR(s.canonicalPaise)}</span>{" "}
                  {s.note || s.categoryName || "uncategorized"} repeats ~monthly
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {s.occurrences}× · last {s.lastDate} · next ≈ {s.nextDueDate}
                </p>
              </div>
              {canCreate ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-7 shrink-0 gap-1 rounded-full text-xs"
                  disabled={creating === s.key}
                  onClick={() => handleCreate(s)}
                >
                  <Plus className="size-3.5" /> Template
                </Button>
              ) : (
                <span
                  className="shrink-0 text-[10px] text-muted-foreground"
                  title="Assign a category to this bill first, then it can become a template"
                >
                  needs category
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-muted-foreground"
                aria-label="Dismiss suggestion"
                onClick={() => dismiss(s.key)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
