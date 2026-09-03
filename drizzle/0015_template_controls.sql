-- §2.12 — template controls: pause, skip-once, variable amounts.
-- Idempotent; safe to re-run.
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "is_paused" boolean DEFAULT false NOT NULL;
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "is_variable" boolean DEFAULT false NOT NULL;
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "skip_month" text;
