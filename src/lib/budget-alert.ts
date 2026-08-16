import { formatINR } from "@/lib/money";

/**
 * §6.7 over-budget alert — returned by the create/update Server Actions when an
 * expense leaves the month total or its category over the effective budget.
 * Client-safe: imported by both the actions (server) and the toast sites.
 */
export interface BudgetAlert {
  kind: "total" | "category";
  /** "This month" for a total alert, otherwise the category's display name. */
  label: string;
  emoji?: string;
  /** How far over the limit, in paise. */
  overPaise: number;
  /** The effective limit, in paise. */
  limitPaise: number;
}

export function budgetAlertMessage(alert: BudgetAlert): string {
  const scope = alert.kind === "total" ? "This month" : `${alert.emoji ?? ""} ${alert.label}`.trim();
  return `${scope} is over budget — ${formatINR(alert.overPaise)} past the ${formatINR(alert.limitPaise)} limit`;
}
