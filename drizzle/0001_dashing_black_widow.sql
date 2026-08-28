CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_id" uuid,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "e2e_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"definition" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "e2e_tests_project_slug_unique" UNIQUE("project_id","slug"),
	CONSTRAINT "e2e_tests_id_project_unique" UNIQUE("id","project_id")
);
--> statement-breakpoint
CREATE TABLE "instructions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instructions_project_slug_unique" UNIQUE("project_id","slug"),
	CONSTRAINT "instructions_id_project_unique" UNIQUE("id","project_id")
);
--> statement-breakpoint
CREATE TABLE "libraries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "libraries_project_slug_unique" UNIQUE("project_id","slug"),
	CONSTRAINT "libraries_id_project_unique" UNIQUE("id","project_id")
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "models_project_slug_unique" UNIQUE("project_id","slug"),
	CONSTRAINT "models_id_project_unique" UNIQUE("id","project_id")
);
--> statement-breakpoint
CREATE TABLE "profile_version_e2e_tests" (
	"profile_version_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"e2e_test_id" uuid NOT NULL,
	CONSTRAINT "profile_version_e2e_tests_pk" PRIMARY KEY("profile_version_id","e2e_test_id")
);
--> statement-breakpoint
CREATE TABLE "profile_version_instructions" (
	"profile_version_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"instruction_id" uuid NOT NULL,
	CONSTRAINT "profile_version_instructions_pk" PRIMARY KEY("profile_version_id","instruction_id")
);
--> statement-breakpoint
CREATE TABLE "profile_version_libraries" (
	"profile_version_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"library_id" uuid NOT NULL,
	CONSTRAINT "profile_version_libraries_pk" PRIMARY KEY("profile_version_id","library_id")
);
--> statement-breakpoint
CREATE TABLE "profile_version_models" (
	"profile_version_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	CONSTRAINT "profile_version_models_pk" PRIMARY KEY("profile_version_id","model_id")
);
--> statement-breakpoint
CREATE TABLE "profile_version_skills" (
	"profile_version_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"skill_version_id" uuid NOT NULL,
	CONSTRAINT "profile_version_skills_pk" PRIMARY KEY("profile_version_id","skill_version_id")
);
--> statement-breakpoint
CREATE TABLE "profile_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_versions_profile_version_unique" UNIQUE("profile_id","version"),
	CONSTRAINT "profile_versions_id_project_unique" UNIQUE("id","project_id")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_project_slug_unique" UNIQUE("project_id","slug"),
	CONSTRAINT "profiles_id_project_unique" UNIQUE("id","project_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "skill_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_version_id" uuid NOT NULL,
	"path" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_files_version_path_unique" UNIQUE("skill_version_id","path")
);
--> statement-breakpoint
CREATE TABLE "skill_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"skill_md" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_versions_skill_version_unique" UNIQUE("skill_id","version"),
	CONSTRAINT "skill_versions_id_project_unique" UNIQUE("id","project_id")
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"source" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"deprecated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_project_source_slug_unique" UNIQUE("project_id","source","slug"),
	CONSTRAINT "skills_id_project_unique" UNIQUE("id","project_id")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "e2e_tests" ADD CONSTRAINT "e2e_tests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructions" ADD CONSTRAINT "instructions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "libraries" ADD CONSTRAINT "libraries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_version_e2e_tests" ADD CONSTRAINT "profile_version_e2e_tests_version_fk" FOREIGN KEY ("profile_version_id","project_id") REFERENCES "public"."profile_versions"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_version_e2e_tests" ADD CONSTRAINT "profile_version_e2e_tests_resource_fk" FOREIGN KEY ("e2e_test_id","project_id") REFERENCES "public"."e2e_tests"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_version_instructions" ADD CONSTRAINT "profile_version_instructions_version_fk" FOREIGN KEY ("profile_version_id","project_id") REFERENCES "public"."profile_versions"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_version_instructions" ADD CONSTRAINT "profile_version_instructions_resource_fk" FOREIGN KEY ("instruction_id","project_id") REFERENCES "public"."instructions"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_version_libraries" ADD CONSTRAINT "profile_version_libraries_version_fk" FOREIGN KEY ("profile_version_id","project_id") REFERENCES "public"."profile_versions"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_version_libraries" ADD CONSTRAINT "profile_version_libraries_resource_fk" FOREIGN KEY ("library_id","project_id") REFERENCES "public"."libraries"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_version_models" ADD CONSTRAINT "profile_version_models_version_fk" FOREIGN KEY ("profile_version_id","project_id") REFERENCES "public"."profile_versions"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_version_models" ADD CONSTRAINT "profile_version_models_resource_fk" FOREIGN KEY ("model_id","project_id") REFERENCES "public"."models"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_version_skills" ADD CONSTRAINT "profile_version_skills_version_fk" FOREIGN KEY ("profile_version_id","project_id") REFERENCES "public"."profile_versions"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_version_skills" ADD CONSTRAINT "profile_version_skills_resource_fk" FOREIGN KEY ("skill_version_id","project_id") REFERENCES "public"."skill_versions"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_versions" ADD CONSTRAINT "profile_versions_profile_project_fk" FOREIGN KEY ("profile_id","project_id") REFERENCES "public"."profiles"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_files" ADD CONSTRAINT "skill_files_skill_version_id_skill_versions_id_fk" FOREIGN KEY ("skill_version_id") REFERENCES "public"."skill_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_skill_project_fk" FOREIGN KEY ("skill_id","project_id") REFERENCES "public"."skills"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_project_created_idx" ON "audit_logs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "e2e_tests_project_idx" ON "e2e_tests" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "instructions_project_idx" ON "instructions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "libraries_project_idx" ON "libraries" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "models_project_idx" ON "models" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "profile_version_e2e_tests_resource_idx" ON "profile_version_e2e_tests" USING btree ("e2e_test_id");--> statement-breakpoint
CREATE INDEX "profile_version_instructions_resource_idx" ON "profile_version_instructions" USING btree ("instruction_id");--> statement-breakpoint
CREATE INDEX "profile_version_libraries_resource_idx" ON "profile_version_libraries" USING btree ("library_id");--> statement-breakpoint
CREATE INDEX "profile_version_models_resource_idx" ON "profile_version_models" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "profile_version_skills_resource_idx" ON "profile_version_skills" USING btree ("skill_version_id");--> statement-breakpoint
CREATE INDEX "profile_versions_profile_idx" ON "profile_versions" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "profiles_project_idx" ON "profiles" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "skill_files_version_idx" ON "skill_files" USING btree ("skill_version_id");--> statement-breakpoint
CREATE INDEX "skill_versions_skill_idx" ON "skill_versions" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "skills_project_idx" ON "skills" USING btree ("project_id");