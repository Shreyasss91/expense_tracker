-- Amendment 17: Add templates table (§6.5)
-- Note: the category_id FK is added (idempotently, with an explicit name) by
-- migration 0005 below, so we declare category_id here WITHOUT the inline
-- REFERENCES. Adding the FK inline here would create an auto-named constraint
-- and a second, differently-named one in 0005 — two FKs on one column.
CREATE TABLE IF NOT EXISTS "templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "category_id" uuid NOT NULL,
  "tag" transaction_tag NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "note" text,
  "sort_order" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "templates_sort_order_idx" ON "templates" ("sort_order");
--> statement-breakpoint

-- Amendment 18: Add reviewed_at column to transactions (§6.4)
-- IF NOT EXISTS keeps a second `db:migrate` run (or a replay after a partial
-- failure) from erroring with "column \"reviewed_at\" already exists".
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp;
