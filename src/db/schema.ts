import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Core data model (Phase 2).
 *
 * Design notes:
 * - Every project-scoped resource table carries `project_id` so cross-project
 *   isolation can be enforced in the database itself. Relationship tables use
 *   *composite* foreign keys of the form `(resource_id, project_id)` against
 *   a unique `(id, project_id)` pair on the resource table, which makes it
 *   impossible for a profile version to reference a resource belonging to
 *   another project.
 * - `profile_versions` and `skill_versions` are immutable. Uniqueness of the
 *   version number per parent plus database triggers (see migration
 *   `0002_immutability_triggers`, hand-written because drizzle-kit cannot
 *   express triggers) forbid UPDATE and DELETE on their rows. New state is
 *   expressed as new versions; retirement is handled with `deprecated` flags,
 *   never by mutating or deleting version rows.
 * - Skills are versioned packages: the `skills` table holds the stable
 *   identity (`source` repository + `slug`), while `skill_versions` holds the
 *   package contents (`skill_md`, i.e. SKILL.md) and `skill_files` holds
 *   optional supporting files per version.
 */

/** Infrastructure metadata (kept from Phase 1). Not domain data. */
export const schemaMeta = pgTable("schema_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/**
 * Ownership + isolation boundary. All configuration resources belong to
 * exactly one project. Slug is globally unique so it can act as a stable
 * external identifier for API paths.
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("projects_slug_unique").on(t.slug)],
);

// ---------------------------------------------------------------------------
// Profiles and immutable profile versions
// ---------------------------------------------------------------------------

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("profiles_project_slug_unique").on(t.projectId, t.slug),
    // Referential target for the composite FK from profile_versions.
    unique("profiles_id_project_unique").on(t.id, t.projectId),
    index("profiles_project_idx").on(t.projectId),
  ],
);

/**
 * Immutable, monotonically numbered snapshot of a profile. Rows are never
 * updated or deleted (enforced by trigger). `project_id` is denormalized from
 * the owning profile and kept consistent by the composite FK
 * `(profile_id, project_id)`, so every version row always knows its project.
 */
export const profileVersions = pgTable(
  "profile_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id").notNull(),
    projectId: uuid("project_id").notNull(),
    version: integer("version").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("profile_versions_profile_version_unique").on(
      t.profileId,
      t.version,
    ),
    unique("profile_versions_id_project_unique").on(t.id, t.projectId),
    check("profile_versions_version_positive", sql`${t.version} >= 1`),
    foreignKey({
      name: "profile_versions_profile_project_fk",
      columns: [t.profileId, t.projectId],
      foreignColumns: [profiles.id, profiles.projectId],
    }),
    index("profile_versions_profile_idx").on(t.profileId),
  ],
);

// ---------------------------------------------------------------------------
// Project-scoped resources
// ---------------------------------------------------------------------------

/** Model/provider selection resource (e.g. provider "anthropic" + model id). */
export const models = pgTable(
  "models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    provider: text("provider").notNull(),
    modelId: text("model_id").notNull(),
    displayName: text("display_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("models_project_slug_unique").on(t.projectId, t.slug),
    unique("models_id_project_unique").on(t.id, t.projectId),
    index("models_project_idx").on(t.projectId),
  ],
);

/** Library dependency resource available to agent environments. */
export const libraries = pgTable(
  "libraries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("libraries_project_slug_unique").on(t.projectId, t.slug),
    unique("libraries_id_project_unique").on(t.id, t.projectId),
    index("libraries_project_idx").on(t.projectId),
  ],
);

/**
 * Skill package identity. The stable identifier used for CLI/API retrieval is
 * `(source, slug)` within a project: `source` is the repository or origin
 * (e.g. `github:owner/repo`) and `slug` is the skill name within it.
 * Versioned contents live in `skill_versions` / `skill_files`.
 */
export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    source: text("source").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    deprecated: boolean("deprecated").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("skills_project_source_slug_unique").on(
      t.projectId,
      t.source,
      t.slug,
    ),
    unique("skills_id_project_unique").on(t.id, t.projectId),
    index("skills_project_idx").on(t.projectId),
  ],
);

/**
 * Immutable skill package version. `skillMd` holds the SKILL.md content;
 * supporting files live in `skill_files`. Rows are never updated or deleted
 * (enforced by trigger).
 */
export const skillVersions = pgTable(
  "skill_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id").notNull(),
    projectId: uuid("project_id").notNull(),
    version: integer("version").notNull(),
    skillMd: text("skill_md").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("skill_versions_skill_version_unique").on(t.skillId, t.version),
    unique("skill_versions_id_project_unique").on(t.id, t.projectId),
    check("skill_versions_version_positive", sql`${t.version} >= 1`),
    foreignKey({
      name: "skill_versions_skill_project_fk",
      columns: [t.skillId, t.projectId],
      foreignColumns: [skills.id, skills.projectId],
    }),
    index("skill_versions_skill_idx").on(t.skillId),
  ],
);

/** Optional supporting files belonging to one skill version. */
export const skillFiles = pgTable(
  "skill_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillVersionId: uuid("skill_version_id")
      .notNull()
      .references(() => skillVersions.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("skill_files_version_path_unique").on(t.skillVersionId, t.path),
    index("skill_files_version_idx").on(t.skillVersionId),
  ],
);

/** Markdown instruction resource (reusable prompt/instruction documents). */
export const instructions = pgTable(
  "instructions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("instructions_project_slug_unique").on(t.projectId, t.slug),
    unique("instructions_id_project_unique").on(t.id, t.projectId),
    index("instructions_project_idx").on(t.projectId),
  ],
);

/** E2E test definition (markdown execution contract for autonomous testing). */
export const e2eTests = pgTable(
  "e2e_tests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    definition: text("definition").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("e2e_tests_project_slug_unique").on(t.projectId, t.slug),
    unique("e2e_tests_id_project_unique").on(t.id, t.projectId),
    index("e2e_tests_project_idx").on(t.projectId),
  ],
);

// ---------------------------------------------------------------------------
// Profile version -> resource relationships
//
// Cross-project isolation is enforced by composite FKs: both the profile
// version side and the resource side must carry the same `project_id`, so a
// profile version can only ever reference resources of its own project.
// ---------------------------------------------------------------------------

function junctionExtras(
  t: { profileVersionId: AnyPgColumn; projectId: AnyPgColumn },
  resourceId: AnyPgColumn,
  resourceRef: [AnyPgColumn, AnyPgColumn],
  names: { pk: string; versionFk: string; resourceFk: string; idx: string },
) {
  return [
    primaryKey({ name: names.pk, columns: [t.profileVersionId, resourceId] }),
    foreignKey({
      name: names.versionFk,
      columns: [t.profileVersionId, t.projectId],
      foreignColumns: [profileVersions.id, profileVersions.projectId],
    }),
    foreignKey({
      name: names.resourceFk,
      columns: [resourceId, t.projectId],
      foreignColumns: resourceRef,
    }),
    index(names.idx).on(resourceId),
  ];
}

export const profileVersionModels = pgTable(
  "profile_version_models",
  {
    profileVersionId: uuid("profile_version_id").notNull(),
    projectId: uuid("project_id").notNull(),
    modelId: uuid("model_id").notNull(),
  },
  (t) =>
    junctionExtras(
      t,
      t.modelId,
      [models.id, models.projectId],
      {
        pk: "profile_version_models_pk",
        versionFk: "profile_version_models_version_fk",
        resourceFk: "profile_version_models_resource_fk",
        idx: "profile_version_models_resource_idx",
      },
    ),
);

export const profileVersionLibraries = pgTable(
  "profile_version_libraries",
  {
    profileVersionId: uuid("profile_version_id").notNull(),
    projectId: uuid("project_id").notNull(),
    libraryId: uuid("library_id").notNull(),
  },
  (t) =>
    junctionExtras(
      t,
      t.libraryId,
      [libraries.id, libraries.projectId],
      {
        pk: "profile_version_libraries_pk",
        versionFk: "profile_version_libraries_version_fk",
        resourceFk: "profile_version_libraries_resource_fk",
        idx: "profile_version_libraries_resource_idx",
      },
    ),
);

/** References a specific immutable skill version, not the mutable skill row. */
export const profileVersionSkills = pgTable(
  "profile_version_skills",
  {
    profileVersionId: uuid("profile_version_id").notNull(),
    projectId: uuid("project_id").notNull(),
    skillVersionId: uuid("skill_version_id").notNull(),
  },
  (t) =>
    junctionExtras(
      t,
      t.skillVersionId,
      [skillVersions.id, skillVersions.projectId],
      {
        pk: "profile_version_skills_pk",
        versionFk: "profile_version_skills_version_fk",
        resourceFk: "profile_version_skills_resource_fk",
        idx: "profile_version_skills_resource_idx",
      },
    ),
);

export const profileVersionInstructions = pgTable(
  "profile_version_instructions",
  {
    profileVersionId: uuid("profile_version_id").notNull(),
    projectId: uuid("project_id").notNull(),
    instructionId: uuid("instruction_id").notNull(),
  },
  (t) =>
    junctionExtras(
      t,
      t.instructionId,
      [instructions.id, instructions.projectId],
      {
        pk: "profile_version_instructions_pk",
        versionFk: "profile_version_instructions_version_fk",
        resourceFk: "profile_version_instructions_resource_fk",
        idx: "profile_version_instructions_resource_idx",
      },
    ),
);

export const profileVersionE2eTests = pgTable(
  "profile_version_e2e_tests",
  {
    profileVersionId: uuid("profile_version_id").notNull(),
    projectId: uuid("project_id").notNull(),
    e2eTestId: uuid("e2e_test_id").notNull(),
  },
  (t) =>
    junctionExtras(
      t,
      t.e2eTestId,
      [e2eTests.id, e2eTests.projectId],
      {
        pk: "profile_version_e2e_tests_pk",
        versionFk: "profile_version_e2e_tests_version_fk",
        resourceFk: "profile_version_e2e_tests_resource_fk",
        idx: "profile_version_e2e_tests_resource_idx",
      },
    ),
);

// ---------------------------------------------------------------------------
// Audit log for configuration mutations
// ---------------------------------------------------------------------------

/**
 * Append-only audit trail of configuration mutations. Rows are only ever
 * inserted; database triggers (see migration `0003`) reject UPDATE and DELETE,
 * and `project_id` uses `ON DELETE set null` so audit history survives project
 * deletion.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id"),
    details: jsonb("details"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("audit_logs_project_created_idx").on(t.projectId, t.createdAt)],
);

