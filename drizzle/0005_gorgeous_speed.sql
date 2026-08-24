CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"tag" "transaction_tag" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"note" text,
	"sort_order" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "category_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "templates_sort_order_idx" ON "templates" USING btree ("sort_order");