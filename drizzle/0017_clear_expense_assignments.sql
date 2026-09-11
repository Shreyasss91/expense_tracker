-- §2.2 revision — "who is this expense for?" starts empty for history.
-- The old `shared` flag / `split_with` list were implicit-attribution
-- leftovers: they were written by capture but never surfaced, and the family
-- asked for a clean slate. Every expense logged so far becomes UNSET; future
-- assignments are explicit and optional. Idempotent; safe to re-run.
UPDATE "transactions"
  SET "split_with" = '{}'::text[], "shared" = false
  WHERE "shared" = true OR cardinality("split_with") > 0;
