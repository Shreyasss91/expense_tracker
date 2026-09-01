-- §2.9 Receipts and attachments.
-- A transaction can carry several photos (a bill plus its GST slip), so
-- receipts are a child table rather than a column. The bytes live in object
-- storage (Vercel Blob); this row keeps the locator plus enough metadata to
-- render a thumbnail and to delete the object again.
--
-- ON DELETE CASCADE: deleting a transaction must not leave orphaned blobs that
-- nobody can reach (and nobody can clean up). The cascade is what lets the
-- existing hard-delete path stay a single statement.
--
-- Idempotent guards so the file is safe to re-run and coexists with db:push.

CREATE TABLE IF NOT EXISTS "attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "transaction_id" uuid NOT NULL REFERENCES "transactions" ("id") ON DELETE CASCADE,
  "pathname" text NOT NULL,
  "url" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Every read of a transaction's receipts is "all attachments for this id",
-- so the FK needs a supporting index of its own (Postgres does not create one
-- automatically for the referencing side).
CREATE INDEX IF NOT EXISTS "attachments_transaction_id_idx"
  ON "attachments" ("transaction_id");
