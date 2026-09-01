-- Recurring auto-entries (UX pass): templates can now stamp themselves into
-- the ledger on a monthly schedule via the daily cron
-- (/api/cron/recurring, see vercel.json).
--
--   auto_day     day of month (1–28) to auto-create; NULL = manual-only
--   last_auto_key "YYYY-MM" of the last auto-stamped month — the idempotency
--                marker that keeps the daily cron from duplicating a bill
--   member_id    whose ledger the entry lands under; NULL = first member
--
-- Idempotent; safe to re-run. The ADD COLUMN statements now use IF NOT EXISTS
-- (the original version lacked it, contradicting this comment), and `db:push`
-- users pick these up from schema.ts directly (no SQL needed).

ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "auto_day" integer;
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "last_auto_key" text;
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "member_id" uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'templates_member_id_members_id_fk') THEN
    ALTER TABLE "templates" ADD CONSTRAINT "templates_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "templates_auto_day_idx" ON "templates" ("auto_day");
