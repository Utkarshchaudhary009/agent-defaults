-- Hand-written migration (Phase 2 review fixes; column-level schema is
-- unchanged so drizzle-kit did not regenerate this).
--
-- 1) Project purges now cascade through the immutable versioning tables.
--    The composite FKs below change to ON DELETE CASCADE and the immutability
--    triggers become depth-aware: a row delete/update that reaches these
--    tables as part of an outer statement cascade (pg_trigger_depth() > 1)
--    is allowed, while direct client UPDATE/DELETE (depth = 1) still raises.
--    This lets `DELETE FROM projects` remove profile versions, skill versions,
--    their supporting files, and their relationships together, with audit
--    history preserved via the existing ON DELETE SET NULL.
ALTER TABLE "profile_versions" DROP CONSTRAINT "profile_versions_profile_project_fk";--> statement-breakpoint
ALTER TABLE "profile_versions" ADD CONSTRAINT "profile_versions_profile_project_fk" FOREIGN KEY ("profile_id","project_id") REFERENCES "public"."profiles"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" DROP CONSTRAINT "skill_versions_skill_project_fk";--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_skill_project_fk" FOREIGN KEY ("skill_id","project_id") REFERENCES "public"."skills"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_version_models" DROP CONSTRAINT "profile_version_models_version_fk";--> statement-breakpoint
ALTER TABLE "profile_version_models" ADD CONSTRAINT "profile_version_models_version_fk" FOREIGN KEY ("profile_version_id","project_id") REFERENCES "public"."profile_versions"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_version_libraries" DROP CONSTRAINT "profile_version_libraries_version_fk";--> statement-breakpoint
ALTER TABLE "profile_version_libraries" ADD CONSTRAINT "profile_version_libraries_version_fk" FOREIGN KEY ("profile_version_id","project_id") REFERENCES "public"."profile_versions"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_version_skills" DROP CONSTRAINT "profile_version_skills_version_fk";--> statement-breakpoint
ALTER TABLE "profile_version_skills" ADD CONSTRAINT "profile_version_skills_version_fk" FOREIGN KEY ("profile_version_id","project_id") REFERENCES "public"."profile_versions"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_version_instructions" DROP CONSTRAINT "profile_version_instructions_version_fk";--> statement-breakpoint
ALTER TABLE "profile_version_instructions" ADD CONSTRAINT "profile_version_instructions_version_fk" FOREIGN KEY ("profile_version_id","project_id") REFERENCES "public"."profile_versions"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_version_e2e_tests" DROP CONSTRAINT "profile_version_e2e_tests_version_fk";--> statement-breakpoint
ALTER TABLE "profile_version_e2e_tests" ADD CONSTRAINT "profile_version_e2e_tests_version_fk" FOREIGN KEY ("profile_version_id","project_id") REFERENCES "public"."profile_versions"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_version_e2e_tests" DROP CONSTRAINT "profile_version_e2e_tests_resource_fk";--> statement-breakpoint
ALTER TABLE "profile_version_e2e_tests" ADD CONSTRAINT "profile_version_e2e_tests_resource_fk" FOREIGN KEY ("e2e_test_id","project_id") REFERENCES "public"."e2e_tests"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_version_instructions" DROP CONSTRAINT "profile_version_instructions_resource_fk";--> statement-breakpoint
ALTER TABLE "profile_version_instructions" ADD CONSTRAINT "profile_version_instructions_resource_fk" FOREIGN KEY ("instruction_id","project_id") REFERENCES "public"."instructions"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_version_libraries" DROP CONSTRAINT "profile_version_libraries_resource_fk";--> statement-breakpoint
ALTER TABLE "profile_version_libraries" ADD CONSTRAINT "profile_version_libraries_resource_fk" FOREIGN KEY ("library_id","project_id") REFERENCES "public"."libraries"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_version_models" DROP CONSTRAINT "profile_version_models_resource_fk";--> statement-breakpoint
ALTER TABLE "profile_version_models" ADD CONSTRAINT "profile_version_models_resource_fk" FOREIGN KEY ("model_id","project_id") REFERENCES "public"."models"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_version_skills" DROP CONSTRAINT "profile_version_skills_resource_fk";--> statement-breakpoint
ALTER TABLE "profile_version_skills" ADD CONSTRAINT "profile_version_skills_resource_fk" FOREIGN KEY ("skill_version_id","project_id") REFERENCES "public"."skill_versions"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Redefine the immutability function to only block *direct* client DML.
-- pg_trigger_depth() is 1 for the first/firing trigger of a statement and goes
-- up for each further nested trigger. A direct client UPDATE/DELETE fires the
-- version trigger as the statement's first trigger (depth 1), so it is
-- rejected; a write that arrives from a parent cascade fires at depth > 1 and
-- is the intended purge path.
CREATE OR REPLACE FUNCTION enforce_immutable_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF pg_trigger_depth() > 1 THEN
		IF TG_OP = 'UPDATE' THEN
			RETURN NEW;
		ELSE
			RETURN OLD;
		END IF;
	END IF;
	RAISE EXCEPTION '% rows are immutable (attempted %)', TG_TABLE_NAME, TG_OP
		USING ERRCODE = 'P0001';
END;
$$;--> statement-breakpoint
-- audit_logs stays append-only: direct UPDATE/DELETE raise; only the
-- FK-driven ON DELETE SET NULL cascade (a nested trigger, depth > 1) may touch
-- rows.
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
-- Prevent a plain TRUNCATE from wiping the audit trail. Table owners still
-- need a maintenance path, so TRUNCATE is honoured only when the session has
-- explicitly opted in via the app.allow_audit_truncate GUC. IS DISTINCT FROM
-- is used because current_setting(..., true) returns NULL when the GUC is
-- unset, and NULL <> 'true' is falsy — otherwise a default session could
-- truncate without opt-in.
CREATE OR REPLACE FUNCTION block_audit_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF current_setting('app.allow_audit_truncate', true) IS DISTINCT FROM 'true' THEN
		RAISE EXCEPTION 'audit_logs truncation is not allowed'
			USING ERRCODE = 'P0001';
	END IF;
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate
BEFORE TRUNCATE ON "audit_logs"
FOR EACH STATEMENT EXECUTE FUNCTION block_audit_truncate();