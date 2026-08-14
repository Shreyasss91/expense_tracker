CREATE TYPE "public"."transaction_tag" AS ENUM('one_time', 'recurring', 'lifestyle');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"emoji" text NOT NULL,
	"color" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"emoji" text NOT NULL,
	"color" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "members_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"type" "transaction_type" DEFAULT 'expense' NOT NULL,
	"tag" "transaction_tag",
	"amount" numeric(12, 2) NOT NULL,
	"note" text,
	"date" date NOT NULL,
	"time" time NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_tag_invariant" CHECK (("transactions"."type" = 'expense' AND "transactions"."tag" IS NOT NULL)
       OR ("transactions"."type" = 'income'  AND "transactions"."tag" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_date_idx" ON "transactions" USING btree ("date");--> statement-breakpoint
CREATE INDEX "transactions_member_id_idx" ON "transactions" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "transactions_category_id_idx" ON "transactions" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "transactions_list_cursor_idx" ON "transactions" USING btree ("date" DESC NULLS LAST,"time" DESC NULLS LAST,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST);