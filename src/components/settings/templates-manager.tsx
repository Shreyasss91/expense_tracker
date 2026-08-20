"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Save, Trash2 } from "lucide-react";
import { createTemplate, deleteTemplate, updateTemplate } from "@/actions/templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CategoryOption, TemplateOption } from "@/components/quick-add/types";

type TemplateTag = TemplateOption["tag"];

function parseAmount(value: string): number {
  const parsed = Number.parseFloat(value.replace(/[,₹\s]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0;
}

function amountInput(paise: number): string {
  return paise > 0 ? String(paise / 100) : "";
}

export function TemplatesManager({ templates, categories }: { templates: TemplateOption[]; categories: CategoryOption[] }) {
  const [items, setItems] = useState(templates);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [tag, setTag] = useState<TemplateTag>("recurring");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState<string | "new" | null>(null);

  function patch(id: string, field: keyof TemplateOption, value: string | number | null) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  }

  async function add() {
    const trimmedName = name.trim();
    const amountPaise = parseAmount(amount);
    if (!trimmedName || !categoryId || amountPaise <= 0) {
      toast.error("Enter a name, amount and category");
      return;
    }
    setSaving("new");
    const result = await createTemplate({ name: trimmedName, categoryId, tag, amount: amountPaise, note: note || null });
    setSaving(null);
    if (!result.ok) {
      toast.error(result.error ?? "Could not save template");
      return;
    }
    setItems((current) => [
      ...current,
      { id: result.id, name: trimmedName, categoryId, tag, amountPaise, note: note || null, sortOrder: current.length + 1 },
    ]);
    setName("");
    setAmount("");
    setNote("");
    toast.success("Template saved");
  }

  async function save(item: TemplateOption) {
    const amountPaise = item.amountPaise;
    if (!item.name.trim() || amountPaise <= 0 || !item.categoryId) {
      toast.error("Enter a name, amount and category");
      return;
    }
    setSaving(item.id);
    const result = await updateTemplate(item.id, {
      name: item.name.trim(),
      categoryId: item.categoryId,
      tag: item.tag,
      amount: amountPaise,
      note: item.note || null,
      sortOrder: item.sortOrder,
    });
    setSaving(null);
    if (result.ok) toast.success("Template saved");
    else toast.error(result.error ?? "Could not save template");
  }

  async function remove(id: string) {
    setSaving(id);
    const result = await deleteTemplate(id);
    setSaving(null);
    if (!result.ok) {
      toast.error(result.error ?? "Could not delete template");
      return;
    }
    setItems((current) => current.filter((item) => item.id !== id));
    toast.success("Template deleted");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">New template</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="new-template-name" className="text-xs">Name</Label>
            <Input id="new-template-name" maxLength={60} placeholder="ICICI Term Insurance" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-template-amount" className="text-xs">Amount</Label>
            <Input id="new-template-amount" inputMode="decimal" placeholder="2500" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-template-category" className="text-xs">Category</Label>
            <select id="new-template-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="h-8 w-full rounded-lg border bg-background px-2 text-sm">
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-template-tag" className="text-xs">Tag</Label>
            <select id="new-template-tag" value={tag} onChange={(e) => setTag(e.target.value as TemplateTag)} className="h-8 w-full rounded-lg border bg-background px-2 text-sm">
              <option value="recurring">Recurring</option>
              <option value="lifestyle">Lifestyle</option>
              <option value="one_time">One-time</option>
            </select>
          </div>
        </div>
        <div className="mt-2 space-y-1">
          <Label htmlFor="new-template-note" className="text-xs">Note (optional)</Label>
          <Input id="new-template-note" maxLength={140} placeholder="Prefill note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button type="button" className="mt-3 gap-1.5" onClick={() => void add()} disabled={saving === "new"}>
          <Plus className="size-4" /> Add template
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No templates yet. Add one for a recurring expense you enter often.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="space-y-2 rounded-lg border p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
                <Input aria-label="Template name" maxLength={60} value={item.name} onChange={(e) => patch(item.id, "name", e.target.value)} />
                <Input aria-label="Template amount" inputMode="decimal" value={amountInput(item.amountPaise)} onChange={(e) => patch(item.id, "amountPaise", parseAmount(e.target.value))} />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <select aria-label="Template category" value={item.categoryId} onChange={(e) => patch(item.id, "categoryId", e.target.value)} className="h-8 w-full rounded-lg border bg-background px-2 text-sm">
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
                <select aria-label="Template tag" value={item.tag} onChange={(e) => patch(item.id, "tag", e.target.value as TemplateTag)} className="h-8 w-full rounded-lg border bg-background px-2 text-sm">
                  <option value="recurring">Recurring</option>
                  <option value="lifestyle">Lifestyle</option>
                  <option value="one_time">One-time</option>
                </select>
              </div>
              <Input aria-label="Template note" maxLength={140} placeholder="Prefill note (optional)" value={item.note ?? ""} onChange={(e) => patch(item.id, "note", e.target.value || null)} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void save(item)} disabled={saving === item.id}>
                  <Save className="size-3.5" /> Save
                </Button>
                <Button type="button" variant="destructive" size="sm" className="gap-1.5" onClick={() => void remove(item.id)} disabled={saving === item.id}>
                  <Trash2 className="size-3.5" /> Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
