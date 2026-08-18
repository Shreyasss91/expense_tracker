"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createCategory } from "@/actions/settings";
import { recordRecentCategory } from "@/lib/category-recents";
import type { CategoryOption } from "@/components/quick-add/types";
import type { AddCategoryForm } from "@/components/transactions/transaction-fields";

/**
 * §6.2/§6.5 — inline "add a new category" flow shared by the Quick Add sheet and
 * the edit-transaction dialog: opens/closes the emoji + name form, calls the
 * createCategory Server Action, and hands the created category to onCreated so
 * the caller can add it to its local grid and select it.
 */
export function useCreateCategory(onCreated: (category: CategoryOption) => void) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = useCallback(() => {
    setAdding(false);
    setName("");
    setEmoji("");
    setError(null);
  }, []);

  const open = useCallback(() => setAdding(true), []);

  const create = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const res = await createCategory({ name, emoji });
    setSaving(false);
    if (res.ok) {
      const c = res.category;
      onCreated({ id: c.id, slug: c.slug, name: c.name, emoji: c.emoji, color: c.color, sortOrder: c.sortOrder });
      recordRecentCategory(c.id);
      cancel();
      toast.success("Category added");
      router.refresh();
    } else {
      setError(res.error ?? "Could not add category");
    }
  }, [saving, name, emoji, onCreated, cancel, router]);

  const addForm: AddCategoryForm | undefined = adding
    ? {
        emoji,
        name,
        saving,
        error,
        onEmojiChange: setEmoji,
        onNameChange: setName,
        onSave: () => void create(),
        onCancel: cancel,
      }
    : undefined;

  return { open, cancel, addForm };
}
