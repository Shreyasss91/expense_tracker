-- §2.12 — persistent audit trail backing the undo toast.
-- Idempotent; safe to re-run.
CREATE TABLE IF NOT EXISTS "activity_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text,
  "actor" text,
  "payload" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "activity_log_created_at_idx" ON "activity_log" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "activity_log_action_idx" ON "activity_log" ("action");
