-- §2.11 Web Push subscriptions.
-- One household → one master password → subscriptions are NOT per-user. Every
-- opted-in device gets the same notifications, so the table needs no member
-- column. The push endpoint is itself the secret-bearing URL, and p256dh/auth
-- are the client's keying material, stored verbatim for draft-ietf-webpush
-- encryption at send time.
--
-- Idempotent guards so db:migrate and db:push both stay safe to re-run.

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "endpoint" text NOT NULL UNIQUE,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "push_subscriptions_created_at_idx"
  ON "push_subscriptions" ("created_at");
