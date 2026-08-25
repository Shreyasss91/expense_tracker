-- Note-search index (UX/perf pass): the ledger's `?q=` filter runs
-- `note ILIKE '%term%'`, which a B-tree cannot serve — every keystroke
-- round-trip was a sequential scan over all transactions. pg_trgm + a GIN
-- index on `note` turns substring search into an index lookup.
--
-- Idempotent, so re-running `npm run db:migrate` (or applying against a
-- branch) is a no-op. pg_trgm is a standard extension, available on Neon.
--
-- NOTE for `db:push` users: drizzle-kit push does NOT run this file — apply
-- once with `npm run db:migrate`, or paste the two statements into the SQL
-- console. After the extension exists, the index also appears in schema.ts
-- so future push/diff cycles keep it.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "transactions_note_trgm_idx" ON "transactions" USING gin ("note" gin_trgm_ops);
