import { v5 as uuidv5 } from "uuid";

/**
 * Deterministic identity for a recurring auto-entry: one transaction per
 * (template, month). The cron stamps the insert with this id and
 * `onConflictDoNothing` on the primary key, so concurrent executions — or a
 * retry after a crash between the insert and the lastAutoKey marker update —
 * collapse onto the same row instead of duplicating the month's expense.
 */
export function recurringTransactionId(templateId: string, monthKey: string): string {
  return uuidv5(`family-ledger:recurring:${templateId.toLowerCase()}:${monthKey}`, uuidv5.DNS);
}
