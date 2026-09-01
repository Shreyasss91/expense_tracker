-- Amendment 20 groundwork: make transactions.category_id nullable and attach a
-- single, explicitly-named FK to templates.category_id.
--
-- This migration MUST BE SAFE TO RE-PLAY. The original version re-issued
-- `CREATE TABLE "templates"`, `CREATE INDEX "templates_sort_order_idx"`, and
-- `ALTER TABLE "transactions" ADD COLUMN "reviewed_at"` -- all already created
-- by migration 0004 -- with no guards. On a fresh database `db:migrate` failed
-- at "relation \"templates\" already exists" / "column \"reviewed_at\" already
-- exists" / "relation \"templates_sort_order_idx\" already exists", so the
-- committed migration chain could never be replayed from scratch (production
-- only worked because it was built with `db:push`, which bypasses the SQL
-- files entirely).
--
-- Those duplicate, unguarded statements are removed below. What remains is
-- purely additive and guarded, so the chain now applies cleanly in order on a
-- fresh Postgres and is a no-op on a database that already has these changes.

-- Idempotent: DROP NOT NULL is a no-op when the column is already nullable.
ALTER TABLE "transactions" ALTER COLUMN "category_id" DROP NOT NULL;

-- Idempotent: only add the named FK when no constraint with that name exists.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'templates_category_id_categories_id_fk'
  ) THEN
    ALTER TABLE "templates"
      ADD CONSTRAINT "templates_category_id_categories_id_fk"
      FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
