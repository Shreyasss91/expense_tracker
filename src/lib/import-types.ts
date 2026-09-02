/**
 * §2.10 — the import contract, in its own module.
 *
 * These types are shared by three layers that must not import each other:
 * the pure parser (ledger-import.ts), the DB resolver (import-apply.ts, which
 * is `server-only`) and the client upload sheet (import-dialog.tsx). Keeping
 * them here means the React component never reaches into server code — not
 * even for a type.
 */

export type ImportSource = "csv-canonical" | "csv-extended" | "json";

export interface ImportIssue {
  row: number;
  message: string;
}

export interface ImportSummary {
  source: ImportSource;
  /** Data rows detected in the file (blank lines excluded). */
  total: number;
  blankRows: number;
  /** Rows rejected by validation (unreadable date/amount/tag, wrong width…). */
  invalid: number;
  /** Rows whose member could not be resolved — skipped. */
  unresolvedMember: number;
  /** Rows whose category could not be resolved — imported uncategorized. */
  unresolvedCategory: number;
  /** Rows already present (by id, or by natural key for CSV restores). */
  duplicate: number;
  /** Rows that will be / were inserted. */
  ready: number;
  /** Receipt locators referenced by the file — metadata only. */
  attachmentsReferenced: number;
  /** The first N problems, so the user can fix and re-upload. */
  issues: ImportIssue[];
  unresolvedMemberNames: string[];
  unresolvedCategoryNames: string[];
}
