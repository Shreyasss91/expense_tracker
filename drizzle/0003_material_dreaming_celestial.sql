DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "transactions" WHERE "type" = 'income') THEN
    RAISE EXCEPTION 'Cannot remove transaction type: historical income rows exist';
  END IF;
END $$;
-- Expense-only migration: retain all existing expense rows; abort on unexpected income data.
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_tag_invariant";--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "tag" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "type";--> statement-breakpoint
DROP TYPE "public"."transaction_type";
