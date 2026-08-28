-- Hand-written migration (Phase 2).
--
-- Why hand-written: drizzle-kit cannot express triggers or functions.
-- `profile_versions` and `skill_versions` rows are immutable — UPDATE and
-- DELETE raise an error. Cleanup jobs may still TRUNCATE (row triggers do not
-- fire for TRUNCATE), and rows can never be silently rewritten.

CREATE OR REPLACE FUNCTION enforce_immutable_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION '% rows are immutable (attempted %)', TG_TABLE_NAME, TG_OP
		USING ERRCODE = 'P0001';
END;
$$;--> statement-breakpoint
CREATE TRIGGER profile_versions_immutable
BEFORE UPDATE OR DELETE ON "profile_versions"
FOR EACH ROW EXECUTE FUNCTION enforce_immutable_row();--> statement-breakpoint
CREATE TRIGGER skill_versions_immutable
BEFORE UPDATE OR DELETE ON "skill_versions"
FOR EACH ROW EXECUTE FUNCTION enforce_immutable_row();
