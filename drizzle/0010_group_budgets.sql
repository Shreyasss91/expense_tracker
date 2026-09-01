-- §2.1 Group-level budgets.
-- A budget row may now target a GROUP (a top-level category row) in addition
-- to a single leaf category or the month total. Spend for a group budget is
-- the roll-up of all its leaves, so a household can cap "Food & Provisions"
-- at ₹10,000 and watch its per-leaf split underneath.
--
-- Enforcement precedence (resolved wherever a budget is displayed/enforced):
--   leaf-with-own-budget  →  parent-group-budget  →  month default  →  every-month default
--
-- Idempotent guards (IF NOT EXISTS) so the file is safe to re-run, and so it
-- coexists with `db:push` (which already applies the schema.ts column).

ALTER TABLE "budgets" ADD COLUMN IF NOT EXISTS "group_id" uuid REFERENCES "categories" ("id");

-- The old scope unique index covered only (month, category_id); a group budget
-- needs group_id in the key too. Rebuild it to cover all three scope axes so
-- at most one total / per-category / per-group row exists per (month, scope).
DROP INDEX IF EXISTS "budgets_scope_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "budgets_scope_unique"
  ON "budgets" (
    COALESCE("month", ''),
    COALESCE("category_id"::text, ''),
    COALESCE("group_id"::text, '')
  );
