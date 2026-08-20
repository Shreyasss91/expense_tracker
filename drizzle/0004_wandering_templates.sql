-- Amendment 17: Add templates table (§6.5)
CREATE TABLE IF NOT EXISTS "templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "category_id" uuid NOT NULL REFERENCES "categories"("id"),
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
ALTER TABLE "transactions" ADD COLUMN "reviewed_at" timestamp;
