-- Two-level category hierarchy (nested category selection):
--
--   categories.parent_id   NULL = a GROUP (top level; never directly
--                          assignable to transactions/templates/budgets)
--                          non-NULL = a LEAF whose parent is a top-level row
--
-- Depth is capped at exactly 2 and enforced by the mutation actions
-- (src/actions/settings.ts) — this migration only carries the schema and the
-- one-time backfill of the household's seven groups.
--
-- Backfill: the 19 seeded categories become leaves under 7 new group rows.
-- Group slugs are prefixed "grp-" so they can never collide with a leaf slug
-- generated from a user-typed name. Existing transactions/budgets/templates
-- keep pointing at their (now-leaf) categories — no row references change.
--
-- Idempotent; safe to re-run.

ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "parent_id" uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_parent_id_categories_id_fk') THEN
    ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- ── the seven household groups ────────────────────────────────────────────
INSERT INTO "categories" ("slug", "name", "emoji", "color", "sort_order") VALUES
  ('grp-getting-around',    'Getting Around',      '🚗', '#0ea5e9', 1),
  ('grp-food-provisions',   'Food & Provisions',   '🍲', '#f59e0b', 2),
  ('grp-people-care',       'People & Care',       '👨‍👩‍👧', '#8b5cf6', 3),
  ('grp-home-bills',        'Home & Bills',        '🏠', '#10b981', 4),
  ('grp-wealth-protection', 'Wealth & Protection', '💰', '#6366f1', 5),
  ('grp-lifestyle-giving',  'Lifestyle & Giving',  '🎉', '#ec4899', 6),
  ('grp-other',             'Other',               '🧺', '#9ca3af', 7)
ON CONFLICT ("slug") DO NOTHING;

-- ── parent every leaf (guarded: only rows not yet parented move) ──────────
UPDATE "categories" SET "parent_id" = (SELECT "id" FROM "categories" WHERE "slug" = 'grp-getting-around')
WHERE "slug" IN ('fuel', 'vehicle-maintenance', 'transport-parking') AND "parent_id" IS NULL;

UPDATE "categories" SET "parent_id" = (SELECT "id" FROM "categories" WHERE "slug" = 'grp-food-provisions')
WHERE "slug" IN ('groceries-household', 'dining-out', 'farm-garden') AND "parent_id" IS NULL;

UPDATE "categories" SET "parent_id" = (SELECT "id" FROM "categories" WHERE "slug" = 'grp-people-care')
WHERE "slug" IN ('kids', 'education', 'health-medical', 'personal-care-fitness', 'clothing') AND "parent_id" IS NULL;

UPDATE "categories" SET "parent_id" = (SELECT "id" FROM "categories" WHERE "slug" = 'grp-home-bills')
WHERE "slug" IN ('home-furniture', 'utilities-recharges') AND "parent_id" IS NULL;

UPDATE "categories" SET "parent_id" = (SELECT "id" FROM "categories" WHERE "slug" = 'grp-wealth-protection')
WHERE "slug" IN ('property-investments', 'insurance-finance') AND "parent_id" IS NULL;

UPDATE "categories" SET "parent_id" = (SELECT "id" FROM "categories" WHERE "slug" = 'grp-lifestyle-giving')
WHERE "slug" IN ('travel-trips', 'entertainment-outings', 'religion-gifts') AND "parent_id" IS NULL;

UPDATE "categories" SET "parent_id" = (SELECT "id" FROM "categories" WHERE "slug" = 'grp-other')
WHERE "slug" = 'misc' AND "parent_id" IS NULL;
