-- §2.2 Per-expense shared ownership.
-- The ledger tracks WHO SPENT (member_id) but not WHO BENEFITS. For a family
-- with a kid most spend is shared, so we add:
--   shared     boolean  — this expense is shared across the household
--   split_with text[]   — explicit member ids to split among; empty = everyone
-- Attribution (the dashboard "Who spent" card) then credits each member their
-- solo spend plus an equal share of each shared expense.
--
-- Idempotent guards so the file is safe to re-run and coexists with db:push.

ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "shared" boolean NOT NULL DEFAULT false;
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "split_with" text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN "transactions"."shared" IS '§2.2 — expense is shared across the household, not borne by one member';
COMMENT ON COLUMN "transactions"."split_with" IS '§2.2 — explicit member ids to split a shared expense among; empty = all members';
