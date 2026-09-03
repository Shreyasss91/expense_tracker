export interface MemberOption {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  color: string;
  sortOrder: number;
}

export interface CategoryOption {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  color: string;
  sortOrder: number;
  /**
   * Two-level hierarchy — NULL = a group row (never selectable), non-NULL =
   * the id of the group this leaf belongs under. Only leaves are assignable
   * to transactions/templates/budgets.
   */
  parentId: string | null;
}

export interface TemplateOption {
  id: string;
  name: string;
  categoryId: string;
  tag: "one_time" | "recurring" | "lifestyle";
  amountPaise: number;
  note: string | null;
  sortOrder: number;
  /** Recurring auto-entry (UX pass): day of month the cron stamps it; null = manual-only. */
  autoDay: number | null;
  /** Whose ledger the auto entry lands under; null = household default (first member). */
  memberId: string | null;
  /** §2.12 — paused never auto-stamps; variable stays manual-only. */
  isPaused: boolean;
  isVariable: boolean;
  /** §2.12 — "YYYY-MM" the auto-stamp skips exactly once, then clears. */
  skipMonth: string | null;
}
