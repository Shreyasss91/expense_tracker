-- §1.9 — partial index to serve the pending-review count/queue query
-- (WHERE reviewed_at IS NULL) without scanning the whole transactions table.
-- The pending-review predicate filters on reviewed_at IS NULL, so a partial
-- index covering exactly those rows lets Postgres satisfy the badge count and
-- the Review queue with an index-only scan instead of a sequential scan.
--
-- Idempotent; safe to re-run (CREATE INDEX IF NOT EXISTS).

CREATE INDEX IF NOT EXISTS "transactions_reviewed_at_pending_idx"
  ON "transactions" ("reviewed_at")
  WHERE "reviewed_at" IS NULL;
