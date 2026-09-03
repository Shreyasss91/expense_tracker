import type { CategoryOption } from "@/components/quick-add/types";

/**
 * §3.7 — the grouped <optgroup> builder for native category selects, shared
 * by the templates manager, the edit dialog's split part select and anywhere
 * else a compact grouped picker is needed. Leaves only — groups are never
 * assignable.
 */
export function CategoryOptgroups({
  categories,
  includeUncategorized = false,
}: {
  categories: CategoryOption[];
  includeUncategorized?: boolean;
}) {
  const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
  const groupRows = sorted.filter((c) => c.parentId === null);
  return (
    <>
      {includeUncategorized && <option value="">Uncategorized</option>}
      {groupRows.map((group) => (
        <optgroup key={group.id} label={`${group.emoji} ${group.name}`}>
          {sorted
            .filter((c) => c.parentId === group.id)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}
