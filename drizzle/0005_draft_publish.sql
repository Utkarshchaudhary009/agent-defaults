-- Hand-written migration (Phase 3 draft/publish lifecycle).
--
-- Why hand-written: drizzle-kit cannot express triggers or functions, and
-- cannot alter a column to add a non-null default for an existing table
-- without a table rewrite. We do it explicitly so the migration is a single
-- sequential pass against a live database.
--
-- 1) Add `status` ('draft' | 'published') and `published_at` columns to the
--    two version tables. New rows default to 'draft'. Existing rows are
--    backfilled to 'published' with `published_at` = `created_at`: the
--    Phase 2 model had no draft state, so pre-existing version rows were
--    always treated as sealed, and we want to preserve that semantics.
-- 2) Replace the version-row immutability trigger function so it only
--    rejects UPDATE / DELETE on **published** rows. Draft versions can be
--    edited (notes, content) and even deleted (e.g. abandoned drafts). The
--    depth-aware branch is preserved so a project purge still cascades
--    through published versions. The function name `enforce_immutable_row`
--    is preserved so the triggers installed by migration 0002 keep firing
--    against the new body without churn.
-- 3) Add sealing triggers to the five `profile_version_*` junction tables
--    and to `skill_files`: once the parent version is `published`, INSERT,
--    UPDATE, and DELETE on children raise. A nested-trigger path
--    (`pg_trigger_depth() > 1`, e.g. a project purge that cascades through
--    the parent version's row, then through the FK CASCADE on the child
--    rows) is allowed so the project-purge semantics from migration 0004
--    still hold. Direct client DML on a published version's children is
--    always rejected.

ALTER TABLE "profile_versions"
  ADD COLUMN "status" text NOT NULL DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "profile_versions"
  ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "skill_versions"
  ADD COLUMN "status" text NOT NULL DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "skill_versions"
  ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
-- Backfill: any pre-existing version row is treated as published; pin
-- `published_at` to `created_at` so the timestamp is meaningful and
-- non-nullable for downstream queries. After this, all existing rows are
-- 'published' and behave as the Phase 2 model intended.
UPDATE "profile_versions" SET "status" = 'published', "published_at" = "created_at";--> statement-breakpoint
UPDATE "skill_versions" SET "status" = 'published', "published_at" = "created_at";--> statement-breakpoint
-- The CHECK constraints from `schema.ts` are also added by the application
-- migration if generated; for the hand-written path we add them here so a
-- direct SQL insert with an invalid status still fails.
ALTER TABLE "profile_versions"
  ADD CONSTRAINT "profile_versions_status_valid"
  CHECK ("status" IN ('draft', 'published'));--> statement-breakpoint
ALTER TABLE "skill_versions"
  ADD CONSTRAINT "skill_versions_status_valid"
  CHECK ("status" IN ('draft', 'published'));--> statement-breakpoint
-- Link the two columns: a published row must carry a `published_at`
-- timestamp, and a draft must not. This keeps the timestamp trustworthy
-- for downstream queries (e.g. "show me everything published this week").
ALTER TABLE "profile_versions"
  ADD CONSTRAINT "profile_versions_status_published_at_match"
  CHECK (
    (("status" = 'published') AND ("published_at" IS NOT NULL))
    OR (("status" = 'draft') AND ("published_at" IS NULL))
  );--> statement-breakpoint
ALTER TABLE "skill_versions"
  ADD CONSTRAINT "skill_versions_status_published_at_match"
  CHECK (
    (("status" = 'published') AND ("published_at" IS NOT NULL))
    OR (("status" = 'draft') AND ("published_at" IS NULL))
  );--> statement-breakpoint
-- Re-define the version-row immutability trigger function in place. The
-- function name is unchanged so the existing triggers
-- (`profile_versions_immutable`, `skill_versions_immutable`) continue to
-- fire against the new body.
--
-- The `skill_files_immutable` trigger installed by migration 0002 is
-- dropped below: the new `seal_published_version_children` trigger on
-- `skill_files` (added at the end of this migration) provides equivalent
-- protection while also enforcing the new "sealed on publish" semantics.
-- The old body rejected every UPDATE/DELETE on skill_files; the new body
-- only rejects when the parent skill version is `published`, and also
-- rejects INSERT (so the file set cannot be added to after publish).
CREATE OR REPLACE FUNCTION enforce_immutable_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Nested-trigger path: an outer cascade (e.g. project purge) is allowed
  -- to delete the row so the cascade can reach children. A nested UPDATE
  -- is rejected: the only legitimate transition out of `published` is
  -- a row delete (during purge), and the publish endpoint is the only
  -- legitimate way to mutate a draft's metadata, which it does at depth
  -- 1. This keeps a future `ON UPDATE CASCADE` from silently rewriting a
  -- published version.
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'nested UPDATE on % is not allowed', TG_TABLE_NAME
        USING ERRCODE = 'P0001';
    ELSE
      RETURN OLD;
    END IF;
  END IF;
  -- Direct client path: only published rows are sealed. Draft rows are
  -- freely editable and even deletable (e.g. an abandoned draft). The
  -- status column is on `profile_versions` and `skill_versions` only;
  -- `skill_files` sealing is handled by the dedicated
  -- `seal_published_version_children` trigger (this function is not
  -- installed on `skill_files`).
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION '% rows are immutable once published (attempted %)', TG_TABLE_NAME, TG_OP
      USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RETURN NEW;
  ELSE
    RETURN OLD;
  END IF;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS skill_files_immutable ON "skill_files";--> statement-breakpoint
-- Sealing trigger for the five profile-version junction tables and
-- `skill_files`. On INSERT / UPDATE / DELETE it looks up the parent
-- version's status; if 'published', the operation is rejected. The
-- contents of a published version are immutable to direct client DML: a
-- nested-trigger path (e.g. a project purge that cascades through the
-- parent version's row, then through the FK CASCADE on the child rows)
-- is allowed. That preserves the design from migration 0004 (project
-- purge cascades through published versions and their children), while
-- still sealing the version against client edits.
CREATE OR REPLACE FUNCTION seal_published_version_children() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status text;
  parent_id uuid;
  parent_table text;
BEGIN
  -- Nested-trigger path: an outer cascade (project purge) is allowed to
  -- delete the child rows so the cascade can complete. Nested UPDATE or
  -- INSERT is rejected: a published version must not gain or change
  -- children as a side effect of any cascade. The only legitimate DELETE
  -- path here is the FK CASCADE from a parent's deletion during project
  -- purge; the parent's own trigger already gated that path.
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RAISE EXCEPTION 'nested % on % is not allowed', TG_OP, TG_TABLE_NAME
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'skill_files' THEN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
      parent_id := NEW.skill_version_id;
    ELSE
      parent_id := OLD.skill_version_id;
    END IF;
    parent_table := 'skill_versions';
  ELSE
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
      parent_id := NEW.profile_version_id;
    ELSE
      parent_id := OLD.profile_version_id;
    END IF;
    parent_table := 'profile_versions';
  END IF;
  -- Look up the parent status. If the parent is gone (e.g. the cascade
  -- already deleted the version row), allow the operation so the child
  -- cleanup completes.
  EXECUTE format('SELECT status FROM %I WHERE id = $1', parent_table)
    INTO parent_status
    USING parent_id;
  IF parent_status IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;
  IF parent_status = 'published' THEN
    RAISE EXCEPTION '% rows are sealed when the parent version is published (attempted %)', TG_TABLE_NAME, TG_OP
      USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;--> statement-breakpoint
CREATE TRIGGER profile_version_models_sealed
BEFORE INSERT OR UPDATE OR DELETE ON "profile_version_models"
FOR EACH ROW EXECUTE FUNCTION seal_published_version_children();--> statement-breakpoint
CREATE TRIGGER profile_version_libraries_sealed
BEFORE INSERT OR UPDATE OR DELETE ON "profile_version_libraries"
FOR EACH ROW EXECUTE FUNCTION seal_published_version_children();--> statement-breakpoint
CREATE TRIGGER profile_version_skills_sealed
BEFORE INSERT OR UPDATE OR DELETE ON "profile_version_skills"
FOR EACH ROW EXECUTE FUNCTION seal_published_version_children();--> statement-breakpoint
CREATE TRIGGER profile_version_instructions_sealed
BEFORE INSERT OR UPDATE OR DELETE ON "profile_version_instructions"
FOR EACH ROW EXECUTE FUNCTION seal_published_version_children();--> statement-breakpoint
CREATE TRIGGER profile_version_e2e_tests_sealed
BEFORE INSERT OR UPDATE OR DELETE ON "profile_version_e2e_tests"
FOR EACH ROW EXECUTE FUNCTION seal_published_version_children();--> statement-breakpoint
CREATE TRIGGER skill_files_sealed
BEFORE INSERT OR UPDATE OR DELETE ON "skill_files"
FOR EACH ROW EXECUTE FUNCTION seal_published_version_children();
