ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_versions" ADD CONSTRAINT "profile_versions_version_positive" CHECK ("profile_versions"."version" >= 1);--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_version_positive" CHECK ("skill_versions"."version" >= 1);--> statement-breakpoint
-- Hand-written additions (Phase 2 review fixes):
-- 1. `skill_files` rows are part of an immutable skill version package, so
--    they must be immutable too (UPDATE/DELETE rejected).
-- 2. `audit_logs` is append-only: direct UPDATE and DELETE are rejected, and
--    `project_id` is `ON DELETE set null` (above) so audit history survives
--    project deletion. The trigger is depth-aware: updates issued by the FK
--    referential action (`pg_trigger_depth() > 1`) are allowed so the set-null
--    cascade can still null out `project_id`; only direct client UPDATEs and
--    DELETEs are rejected.
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'audit_logs rows are append-only (attempted %)', TG_OP
		USING ERRCODE = 'P0001';
END;
$$;--> statement-breakpoint
CREATE TRIGGER skill_files_immutable
BEFORE UPDATE OR DELETE ON "skill_files"
FOR EACH ROW EXECUTE FUNCTION enforce_immutable_row();--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();