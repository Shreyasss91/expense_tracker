-- §2.7 Saved ledger searches (household-wide named filter presets).
-- Each row stores the serialized LedgerFilters so a tap re-applies the exact
-- query ("Big fuel spends", "Kid stuff last quarter"). No per-member column:
-- one master password = one household.
--
-- Idempotent guards so the file is safe to re-run and coexists with db:push.

CREATE TABLE IF NOT EXISTS "saved_searches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "params" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
