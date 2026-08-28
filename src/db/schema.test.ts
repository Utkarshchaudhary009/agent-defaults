import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Database } from "./client";
import {
  auditLogs,
  e2eTests,
  instructions,
  libraries,
  models,
  profileVersions,
  profileVersionE2eTests,
  profileVersionInstructions,
  profileVersionLibraries,
  profileVersionModels,
  profileVersionSkills,
  profiles,
  projects,
  skillFiles,
  skillVersions,
  skills,
} from "./schema";

/**
 * DB-backed schema tests (Phase 2 verification).
 *
 * These tests run against a real PostgreSQL test database and apply the
 * generated drizzle migrations plus the hand-written immutability-trigger
 * migration. They truncate and re-migrate the connected database, so they
 * MUST NEVER run against the app runtime config (`DATABASE_URL`). They only
 * run when an explicit `TEST_DATABASE_URL` is provided; otherwise they are
 * skipped so the rest of the suite runs without a database.
 */

// Deliberately no `DATABASE_URL` fallback: this suite truncates the connected
// database. Requiring `TEST_DATABASE_URL` ensures a stray or real app
// DATABASE_URL can never be wiped by a test run.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const withDb = testDatabaseUrl ? describe : describe.skip;

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle/", import.meta.url),
);

type Project = typeof projects.$inferSelect;
type Profile = typeof profiles.$inferSelect;
type ProfileVersion = typeof profileVersions.$inferSelect;

let sql: postgres.Sql;
let db: Database;

// Dedicated, single-connection client used only for per-test cleanup. The
// audit-log TRUNCATE guard is GUC-based, and a GUC set on one pooled
// connection does not apply to another, so cleanup must run on its own
// connection with the maintenance flag set once.
let cleanup: postgres.Sql;

/** Insert a project with a synthetic name and return the persisted row. */
async function createProject(slug: string): Promise<Project> {
  const rows = await db
    .insert(projects)
    .values({ slug, name: `Project ${slug}` })
    .returning();
  if (!rows[0]) throw new Error("project insert returned no rows");
  return rows[0];
}

/** Insert a profile that belongs to `projectId` and return the persisted row. */
async function createProfile(
  projectId: string,
  slug: string,
): Promise<Profile> {
  const rows = await db
    .insert(profiles)
    .values({ projectId, slug, name: `Profile ${slug}` })
    .returning();
  if (!rows[0]) throw new Error("profile insert returned no rows");
  return rows[0];
}

/** Insert an immutable profile version row and return the persisted row. */
async function createProfileVersion(
  profileId: string,
  projectId: string,
  version: number,
): Promise<ProfileVersion> {
  const rows = await db
    .insert(profileVersions)
    .values({ profileId, projectId, version })
    .returning();
  if (!rows[0]) throw new Error("profile version insert returned no rows");
  return rows[0];
}

/** Flip a profile version to `published` (the API will own this in Phase 3). */
async function publishProfileVersion(versionId: string): Promise<void> {
  await db
    .update(profileVersions)
    .set({ status: "published", publishedAt: new Date() })
    .where(eq(profileVersions.id, versionId));
}

/** Flip a skill version to `published` (the API will own this in Phase 3). */
async function publishSkillVersion(versionId: string): Promise<void> {
  await db
    .update(skillVersions)
    .set({ status: "published", publishedAt: new Date() })
    .where(eq(skillVersions.id, versionId));
}

/** Assert that a promise rejects with a specific PostgreSQL error code. */
async function expectPgError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  // Drizzle wraps driver errors (DrizzleQueryError); the PostgreSQL error
  // (with its SQLSTATE code) is on the `cause` chain.
  const pgCode = (error: unknown): string | undefined => {
    let current = error;
    for (let depth = 0; current && depth < 5; depth += 1) {
      const code = (current as { code?: string }).code;
      if (typeof code === "string" && /^\d{5}|^P0001$/.test(code)) return code;
      current = (current as { cause?: unknown }).cause;
    }
    return undefined;
  };
  expect(pgCode(caught), `expected PG error ${code}`).toBe(code);
}

withDb("core data model (Phase 2)", () => {
  beforeAll(async () => {
    const url = testDatabaseUrl as string;
    const created = createDb(url);
    sql = created.sql;
    db = created.db;
    await migrate(db, { migrationsFolder });

    // Cleanup connection used by beforeEach; enable the audit-truncate
    // maintenance path on this one session.
    cleanup = postgres(url, { max: 1, prepare: false });
    await cleanup.unsafe(`SET app.allow_audit_truncate = 'true'`);
  });

  afterAll(async () => {
    await cleanup.end({ timeout: 5 });
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    // TRUNCATE bypasses the immutability row triggers, so it is safe for
    // cleanup. The audit_logs TRUNCATE guard (0004) is satisfied for this
    // dedicated cleanup connection, which has the maintenance GUC enabled.
    await cleanup.unsafe(`
      TRUNCATE TABLE
        projects, profiles, profile_versions,
        models, libraries, skills, skill_versions, skill_files,
        instructions, e2e_tests,
        profile_version_models, profile_version_libraries,
        profile_version_skills, profile_version_instructions,
        profile_version_e2e_tests,
        audit_logs
      CASCADE
    `);
  });

  describe("uniqueness and NOT NULL constraints", () => {
    it("rejects duplicate project slugs", async () => {
      await createProject("alpha");
      await expectPgError(
        db.insert(projects).values({ slug: "alpha", name: "dup" }),
        "23505",
      );
    });

    it("rejects duplicate profile slugs within a project but allows them across projects", async () => {
      const a = await createProject("proj-a");
      const b = await createProject("proj-b");
      await createProfile(a.id, "default");
      await expectPgError(
        db.insert(profiles).values({ projectId: a.id, slug: "default", name: "dup" }),
        "23505",
      );
      // Same slug in another project is fine.
      const created = await createProfile(b.id, "default");
      expect(created.projectId).toBe(b.id);
    });

    it("rejects duplicate version numbers per profile", async () => {
      const p = await createProject("proj-a");
      const profile = await createProfile(p.id, "default");
      await createProfileVersion(profile.id, p.id, 1);
      await expectPgError(
        db
          .insert(profileVersions)
          .values({ profileId: profile.id, projectId: p.id, version: 1 }),
        "23505",
      );

      await createProfileVersion(profile.id, p.id, 2);
      await createProfileVersion(profile.id, p.id, 3);
      const versions = await db
        .select({ version: profileVersions.version })
        .from(profileVersions)
        .where(eq(profileVersions.profileId, profile.id));
      expect(versions.map((v) => v.version).sort((a, b) => a - b)).toEqual([
        1, 2, 3,
      ]);
    });

    it("rejects duplicate skills by (project, source, slug)", async () => {
      const p = await createProject("proj-a");
      await db.insert(skills).values({
        projectId: p.id,
        slug: "code-review",
        source: "github:owner/repo",
        name: "Code Review",
      });
      await expectPgError(
        db.insert(skills).values({
          projectId: p.id,
          slug: "code-review",
          source: "github:owner/repo",
          name: "dup",
        }),
        "23505",
      );
    });

    it("rejects duplicate supporting-file paths within a skill version", async () => {
      const p = await createProject("proj-a");
      const [skill] = await db
        .insert(skills)
        .values({ projectId: p.id, slug: "s", source: "src", name: "S" })
        .returning();
      if (!skill) throw new Error("skill insert failed");
      const [version] = await db
        .insert(skillVersions)
        .values({
          skillId: skill.id,
          projectId: p.id,
          version: 1,
          skillMd: "# S",
        })
        .returning();
      if (!version) throw new Error("skill version insert failed");
      await db
        .insert(skillFiles)
        .values({ skillVersionId: version.id, path: "a.md", content: "x" });
      await expectPgError(
        db
          .insert(skillFiles)
          .values({ skillVersionId: version.id, path: "a.md", content: "y" }),
        "23505",
      );
    });

    it("rejects duplicate instruction and e2e-test slugs per project", async () => {
      const p = await createProject("proj-a");
      await db.insert(instructions).values({
        projectId: p.id,
        slug: "base",
        name: "Base",
        content: "# instructions",
      });
      await expectPgError(
        db
          .insert(instructions)
          .values({ projectId: p.id, slug: "base", name: "dup", content: "x" }),
        "23505",
      );
      await db.insert(e2eTests).values({
        projectId: p.id,
        slug: "smoke",
        name: "Smoke",
        definition: "# e2e",
      });
      await expectPgError(
        db
          .insert(e2eTests)
          .values({ projectId: p.id, slug: "smoke", name: "dup", definition: "x" }),
        "23505",
      );
    });

    it("enforces NOT NULL on required columns", async () => {
      const p = await createProject("proj-a");
      await expectPgError(
        sql`INSERT INTO models (project_id, slug, provider, model_id)
            VALUES (${p.id}, 'm', NULL, 'x')`,
        "23502",
      );
      await expectPgError(
        sql`INSERT INTO skill_versions (skill_id, project_id, version, skill_md)
            VALUES (${crypto.randomUUID()}, ${p.id}, 1, NULL)`,
        "23502",
      );
    });

    it("enforces foreign keys on project references", async () => {
      await expectPgError(
        db
          .insert(profiles)
          .values({ projectId: crypto.randomUUID(), slug: "p", name: "P" }),
        "23503",
      );
    });

    it("keeps profile_versions project_id consistent with the owning profile via composite FK", async () => {
      const a = await createProject("proj-a");
      const b = await createProject("proj-b");
      const profile = await createProfile(a.id, "default");
      await expectPgError(
        db
          .insert(profileVersions)
          .values({ profileId: profile.id, projectId: b.id, version: 1 }),
        "23503",
      );
    });
  });

  describe("profile/version persistence and immutability", () => {
    it("creates a profile with multiple monotonic versions", async () => {
      const p = await createProject("proj-a");
      const profile = await createProfile(p.id, "default");
      await createProfileVersion(profile.id, p.id, 1);
      await createProfileVersion(profile.id, p.id, 2);

      const rows = await db
        .select()
        .from(profileVersions)
        .where(eq(profileVersions.profileId, profile.id));
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((r) => r.projectId))).toEqual(new Set([p.id]));
    });

    it("rejects UPDATE on published profile version rows", async () => {
      const p = await createProject("proj-a");
      const profile = await createProfile(p.id, "default");
      const version = await createProfileVersion(profile.id, p.id, 1);
      await publishProfileVersion(version.id);
      await expectPgError(
        db
          .update(profileVersions)
          .set({ version: 99 })
          .where(eq(profileVersions.id, version.id)),
        "P0001",
      );
      const rows = await db
        .select()
        .from(profileVersions)
        .where(eq(profileVersions.id, version.id));
      expect(rows[0]?.version).toBe(1);
    });

    it("rejects DELETE on published profile version rows", async () => {
      const p = await createProject("proj-a");
      const profile = await createProfile(p.id, "default");
      const version = await createProfileVersion(profile.id, p.id, 1);
      await publishProfileVersion(version.id);
      await expectPgError(
        db.delete(profileVersions).where(eq(profileVersions.id, version.id)),
        "P0001",
      );
      const rows = await db
        .select()
        .from(profileVersions)
        .where(eq(profileVersions.id, version.id));
      expect(rows).toHaveLength(1);
    });

    it("allows UPDATE and DELETE on draft profile version rows", async () => {
      const p = await createProject("proj-a");
      const profile = await createProfile(p.id, "default");
      const version = await createProfileVersion(profile.id, p.id, 1);
      expect(version.status).toBe("draft");
      // Drafts are editable: rename, retitle, even delete (e.g. an
      // abandoned draft).
      const [updated] = await db
        .update(profileVersions)
        .set({ notes: "in progress" })
        .where(eq(profileVersions.id, version.id))
        .returning();
      expect(updated?.notes).toBe("in progress");
      await db
        .delete(profileVersions)
        .where(eq(profileVersions.id, version.id));
      const rows = await db
        .select()
        .from(profileVersions)
        .where(eq(profileVersions.id, version.id));
      expect(rows).toHaveLength(0);
    });

    it("rejects UPDATE and DELETE on published skill version rows", async () => {
      const p = await createProject("proj-a");
      const [skill] = await db
        .insert(skills)
        .values({ projectId: p.id, slug: "s", source: "src", name: "S" })
        .returning();
      if (!skill) throw new Error("skill insert failed");
      const [version] = await db
        .insert(skillVersions)
        .values({ skillId: skill.id, projectId: p.id, version: 1, skillMd: "# S" })
        .returning();
      if (!version) throw new Error("skill version insert failed");
      await publishSkillVersion(version.id);
      await expectPgError(
        db
          .update(skillVersions)
          .set({ skillMd: "# rewritten" })
          .where(eq(skillVersions.id, version.id)),
        "P0001",
      );
      await expectPgError(
        db.delete(skillVersions).where(eq(skillVersions.id, version.id)),
        "P0001",
      );
    });

    it("registers immutability triggers on both version tables", async () => {
      const triggers = await sql.unsafe<{ tgname: string }[]>(
        `SELECT tgname FROM pg_trigger
         WHERE tgrelid IN ('profile_versions'::regclass, 'skill_versions'::regclass)
           AND NOT tgisinternal`,
      );
      expect(triggers.map((t) => t.tgname).sort()).toEqual([
        "profile_versions_immutable",
        "skill_versions_immutable",
      ]);
    });

    it("rejects version numbers below 1", async () => {
      const p = await createProject("proj-a");
      const profile = await createProfile(p.id, "default");
      await expectPgError(
        createProfileVersion(profile.id, p.id, 0),
        "23514",
      );
      await expectPgError(
        createProfileVersion(profile.id, p.id, -1),
        "23514",
      );

      const [skill] = await db
        .insert(skills)
        .values({ projectId: p.id, slug: "s", source: "src", name: "S" })
        .returning();
      if (!skill) throw new Error("skill insert failed");
      await expectPgError(
        db
          .insert(skillVersions)
          .values({ skillId: skill.id, projectId: p.id, version: 0, skillMd: "# S" }),
        "23514",
      );
    });

    it("rejects UPDATE and DELETE on skill file rows of a published skill version", async () => {
      const p = await createProject("proj-a");
      const [skill] = await db
        .insert(skills)
        .values({ projectId: p.id, slug: "s", source: "src", name: "S" })
        .returning();
      if (!skill) throw new Error("skill insert failed");
      const [version] = await db
        .insert(skillVersions)
        .values({ skillId: skill.id, projectId: p.id, version: 1, skillMd: "# S" })
        .returning();
      if (!version) throw new Error("skill version insert failed");
      const [file] = await db
        .insert(skillFiles)
        .values({ skillVersionId: version.id, path: "run.sh", content: "sh" })
        .returning();
      if (!file) throw new Error("skill file insert failed");
      await publishSkillVersion(version.id);

      await expectPgError(
        db
          .update(skillFiles)
          .set({ content: "rewritten" })
          .where(eq(skillFiles.id, file.id)),
        "P0001",
      );
      await expectPgError(
        db.delete(skillFiles).where(eq(skillFiles.id, file.id)),
        "P0001",
      );
    });
  });

  describe("draft/publish lifecycle (Phase 3)", () => {
    it("creates new version rows in `draft` with no published_at", async () => {
      const p = await createProject("proj-a");
      const profile = await createProfile(p.id, "default");
      const version = await createProfileVersion(profile.id, p.id, 1);
      expect(version.status).toBe("draft");
      expect(version.publishedAt).toBeNull();
    });

    it("lets a draft profile version edit its junction rows freely", async () => {
      const p = await createProject("proj-a");
      const profile = await createProfile(p.id, "default");
      const version = await createProfileVersion(profile.id, p.id, 1);

      const [model] = await db
        .insert(models)
        .values({ projectId: p.id, slug: "sonnet", provider: "anthropic", modelId: "claude-sonnet" })
        .returning();
      if (!model) throw new Error("model insert failed");

      // Insert, update, and delete a junction row while the parent is draft.
      const [j1] = await db
        .insert(profileVersionModels)
        .values({ profileVersionId: version.id, projectId: p.id, modelId: model.id })
        .returning();
      if (!j1) throw new Error("junction insert failed");
      await db
        .update(profileVersionModels)
        .set({ modelId: model.id })
        .where(eq(profileVersionModels.profileVersionId, version.id));
      await db
        .delete(profileVersionModels)
        .where(eq(profileVersionModels.profileVersionId, version.id));
      const remaining = await db
        .select()
        .from(profileVersionModels)
        .where(eq(profileVersionModels.profileVersionId, version.id));
      expect(remaining).toHaveLength(0);
    });

    it("lets a draft skill version add and remove supporting files", async () => {
      const p = await createProject("proj-a");
      const [skill] = await db
        .insert(skills)
        .values({ projectId: p.id, slug: "s", source: "src", name: "S" })
        .returning();
      if (!skill) throw new Error("skill insert failed");
      const [version] = await db
        .insert(skillVersions)
        .values({ skillId: skill.id, projectId: p.id, version: 1, skillMd: "# S" })
        .returning();
      if (!version) throw new Error("skill version insert failed");

      const [file] = await db
        .insert(skillFiles)
        .values({ skillVersionId: version.id, path: "run.sh", content: "sh" })
        .returning();
      if (!file) throw new Error("file insert failed");
      await db
        .update(skillFiles)
        .set({ content: "rewritten" })
        .where(eq(skillFiles.id, file.id));
      await db.delete(skillFiles).where(eq(skillFiles.id, file.id));
      const remaining = await db
        .select()
        .from(skillFiles)
        .where(eq(skillFiles.skillVersionId, version.id));
      expect(remaining).toHaveLength(0);
    });

    it("seals every junction of a profile version after publish", async () => {
      const p = await createProject("proj-a");
      const profile = await createProfile(p.id, "default");
      const version = await createProfileVersion(profile.id, p.id, 1);

      // Insert one of each resource up front (while the version is still
      // draft) so we can use them as the FK target once the version is
      // published and the seal test starts.
      const [model] = await db
        .insert(models)
        .values({ projectId: p.id, slug: "sonnet", provider: "anthropic", modelId: "claude-sonnet" })
        .returning();
      if (!model) throw new Error("model insert failed");
      const [library] = await db
        .insert(libraries)
        .values({ projectId: p.id, slug: "lib", name: "Lib" })
        .returning();
      if (!library) throw new Error("library insert failed");
      const [skill] = await db
        .insert(skills)
        .values({ projectId: p.id, slug: "s", source: "src", name: "S" })
        .returning();
      if (!skill) throw new Error("skill insert failed");
      const [skillVersion] = await db
        .insert(skillVersions)
        .values({ skillId: skill.id, projectId: p.id, version: 1, skillMd: "# S" })
        .returning();
      if (!skillVersion) throw new Error("skill version insert failed");
      const [instruction] = await db
        .insert(instructions)
        .values({ projectId: p.id, slug: "i", name: "I", content: "..." })
        .returning();
      if (!instruction) throw new Error("instruction insert failed");
      const [e2eTest] = await db
        .insert(e2eTests)
        .values({ projectId: p.id, slug: "e", name: "E", definition: "..." })
        .returning();
      if (!e2eTest) throw new Error("e2e insert failed");

      // Wire up one junction row in every junction table while the
      // version is still draft, so the seal test has a real row to
      // target.
      await db.insert(profileVersionModels).values({
        profileVersionId: version.id,
        projectId: p.id,
        modelId: model.id,
      });
      await db.insert(profileVersionLibraries).values({
        profileVersionId: version.id,
        projectId: p.id,
        libraryId: library.id,
      });
      await db.insert(profileVersionSkills).values({
        profileVersionId: version.id,
        projectId: p.id,
        skillVersionId: skillVersion.id,
      });
      await db.insert(profileVersionInstructions).values({
        profileVersionId: version.id,
        projectId: p.id,
        instructionId: instruction.id,
      });
      await db.insert(profileVersionE2eTests).values({
        profileVersionId: version.id,
        projectId: p.id,
        e2eTestId: e2eTest.id,
      });

      await publishProfileVersion(version.id);

      // All five junction tables must reject INSERT and DELETE.
      await expectPgError(
        db.insert(profileVersionModels).values({
          profileVersionId: version.id,
          projectId: p.id,
          modelId: model.id,
        }),
        "P0001",
      );
      await expectPgError(
        db.insert(profileVersionLibraries).values({
          profileVersionId: version.id,
          projectId: p.id,
          libraryId: library.id,
        }),
        "P0001",
      );
      await expectPgError(
        db.insert(profileVersionSkills).values({
          profileVersionId: version.id,
          projectId: p.id,
          skillVersionId: skillVersion.id,
        }),
        "P0001",
      );
      await expectPgError(
        db.insert(profileVersionInstructions).values({
          profileVersionId: version.id,
          projectId: p.id,
          instructionId: instruction.id,
        }),
        "P0001",
      );
      await expectPgError(
        db.insert(profileVersionE2eTests).values({
          profileVersionId: version.id,
          projectId: p.id,
          e2eTestId: e2eTest.id,
        }),
        "P0001",
      );

      for (const table of [
        profileVersionModels,
        profileVersionLibraries,
        profileVersionSkills,
        profileVersionInstructions,
        profileVersionE2eTests,
      ]) {
        await expectPgError(
          db
            .delete(table)
            .where(eq((table as unknown as { profileVersionId: typeof profileVersionModels.profileVersionId }).profileVersionId, version.id)),
          "P0001",
        );
      }
    });

    it("seals skill_files of a skill version after publish", async () => {
      const p = await createProject("proj-a");
      const [skill] = await db
        .insert(skills)
        .values({ projectId: p.id, slug: "s", source: "src", name: "S" })
        .returning();
      if (!skill) throw new Error("skill insert failed");
      const [version] = await db
        .insert(skillVersions)
        .values({ skillId: skill.id, projectId: p.id, version: 1, skillMd: "# S" })
        .returning();
      if (!version) throw new Error("skill version insert failed");
      const [file] = await db
        .insert(skillFiles)
        .values({ skillVersionId: version.id, path: "run.sh", content: "sh" })
        .returning();
      if (!file) throw new Error("file insert failed");
      await publishSkillVersion(version.id);

      await expectPgError(
        db.insert(skillFiles).values({
          skillVersionId: version.id,
          path: "another.sh",
          content: "sh",
        }),
        "P0001",
      );
      await expectPgError(
        db
          .update(skillFiles)
          .set({ content: "rewritten" })
          .where(eq(skillFiles.id, file.id)),
        "P0001",
      );
      await expectPgError(
        db.delete(skillFiles).where(eq(skillFiles.id, file.id)),
        "P0001",
      );
    });

    it("rejects a status flip from `published` back to `draft`", async () => {
      const p = await createProject("proj-a");
      const profile = await createProfile(p.id, "default");
      const version = await createProfileVersion(profile.id, p.id, 1);
      await publishProfileVersion(version.id);
      await expectPgError(
        db
          .update(profileVersions)
          .set({ status: "draft" })
          .where(eq(profileVersions.id, version.id)),
        "P0001",
      );
      const [after] = await db
        .select()
        .from(profileVersions)
        .where(eq(profileVersions.id, version.id));
      expect(after?.status).toBe("published");
    });

    it("rejects invalid status values at the database level", async () => {
      const p = await createProject("proj-a");
      const profile = await createProfile(p.id, "default");
      // Bypass the typed insert to push a value the CHECK constraint
      // should reject.
      await expectPgError(
        sql.unsafe(
          `INSERT INTO profile_versions (profile_id, project_id, version, status)
           VALUES ($1, $2, 1, 'weird')`,
          [profile.id, p.id],
        ),
        "23514",
      );
    });

    it("still cascades a project purge through draft and published versions", async () => {
      const p = await createProject("proj-a");
      const profile = await createProfile(p.id, "default");
      const draft = await createProfileVersion(profile.id, p.id, 1);
      const published = await createProfileVersion(profile.id, p.id, 2);

      const [model] = await db
        .insert(models)
        .values({ projectId: p.id, slug: "m", provider: "anthropic", modelId: "x" })
        .returning();
      if (!model) throw new Error("model insert failed");
      // Wire the model to the *draft* version, then publish that version.
      await db.insert(profileVersionModels).values({
        profileVersionId: published.id,
        projectId: p.id,
        modelId: model.id,
      });
      await publishProfileVersion(published.id);

      await db.delete(projects).where(eq(projects.id, p.id));
      const remaining = await db
        .select()
        .from(profileVersions)
        .where(eq(profileVersions.profileId, profile.id));
      expect(remaining).toHaveLength(0);
      const junctions = await db
        .select()
        .from(profileVersionModels)
        .where(eq(profileVersionModels.modelId, model.id));
      expect(junctions).toHaveLength(0);
      // Sanity: the draft we created had no published state.
      expect(draft.status).toBe("draft");
    });
  });

  describe("skill packages", () => {
    it("stores SKILL.md content and supporting files per version and resolves the stable identifier", async () => {
      const p = await createProject("proj-a");
      const skillMd = "# Code Review\n\nReview diffs carefully.";
      const files = [
        { path: "scripts/run.sh", content: "#!/bin/sh\necho review" },
        { path: "references/checklist.md", content: "- [ ] correctness" },
      ];

      const [skill] = await db
        .insert(skills)
        .values({
          projectId: p.id,
          slug: "code-review",
          source: "github:owner/repo",
          name: "Code Review",
          description: "Reviews diffs",
        })
        .returning();
      if (!skill) throw new Error("skill insert failed");

      const [version] = await db
        .insert(skillVersions)
        .values({ skillId: skill.id, projectId: p.id, version: 1, skillMd })
        .returning();
      if (!version) throw new Error("skill version insert failed");

      await db
        .insert(skillFiles)
        .values(files.map((f) => ({ skillVersionId: version.id, ...f })));

      // Resolve the package by its stable identifier (project + source + slug).
      const [resolved] = await db
        .select()
        .from(skills)
        .where(
          and(
            eq(skills.projectId, p.id),
            eq(skills.source, "github:owner/repo"),
            eq(skills.slug, "code-review"),
          ),
        );
      if (!resolved) throw new Error("stable identifier lookup failed");

      const [storedVersion] = await db
        .select()
        .from(skillVersions)
        .where(eq(skillVersions.skillId, resolved.id));
      if (!storedVersion) throw new Error("no version for skill");

      const storedFiles = await db
        .select()
        .from(skillFiles)
        .where(eq(skillFiles.skillVersionId, storedVersion.id));

      expect(resolved.slug).toBe("code-review");
      expect(storedVersion.version).toBe(1);
      expect(storedVersion.skillMd).toBe(skillMd);
      expect(storedFiles.map((f) => ({ path: f.path, content: f.content }))).toEqual(
        files,
      );
    });

    it("creates a new immutable version rather than mutating the old one", async () => {
      const p = await createProject("proj-a");
      const [skill] = await db
        .insert(skills)
        .values({ projectId: p.id, slug: "s", source: "src", name: "S" })
        .returning();
      if (!skill) throw new Error("skill insert failed");
      await db
        .insert(skillVersions)
        .values({ skillId: skill.id, projectId: p.id, version: 1, skillMd: "v1" });
      await db
        .insert(skillVersions)
        .values({ skillId: skill.id, projectId: p.id, version: 2, skillMd: "v2" });

      const versions = await db
        .select()
        .from(skillVersions)
        .where(eq(skillVersions.skillId, skill.id));
      const byVersion = new Map(versions.map((v) => [v.version, v.skillMd]));
      expect(byVersion.get(1)).toBe("v1");
      expect(byVersion.get(2)).toBe("v2");
    });
  });

  describe("cross-project isolation", () => {
    it("prevents a profile version from referencing another project's resources", async () => {
      const a = await createProject("proj-a");
      const b = await createProject("proj-b");

      // Project A owns the resources; project B owns the profile version.
      const [modelA] = await db
        .insert(models)
        .values({ projectId: a.id, slug: "sonnet", provider: "anthropic", modelId: "claude-sonnet" })
        .returning();
      if (!modelA) throw new Error("model insert failed");
      const [libraryA] = await db
        .insert(libraries)
        .values({ projectId: a.id, slug: "lib", name: "Lib" })
        .returning();
      if (!libraryA) throw new Error("library insert failed");
      const [skillA] = await db
        .insert(skills)
        .values({ projectId: a.id, slug: "s", source: "src", name: "S" })
        .returning();
      if (!skillA) throw new Error("skill insert failed");
      const [skillVersionA] = await db
        .insert(skillVersions)
        .values({ skillId: skillA.id, projectId: a.id, version: 1, skillMd: "# S" })
        .returning();
      if (!skillVersionA) throw new Error("skill version insert failed");
      const [instructionA] = await db
        .insert(instructions)
        .values({ projectId: a.id, slug: "i", name: "I", content: "# I" })
        .returning();
      if (!instructionA) throw new Error("instruction insert failed");
      const [e2eA] = await db
        .insert(e2eTests)
        .values({ projectId: a.id, slug: "e", name: "E", definition: "# E" })
        .returning();
      if (!e2eA) throw new Error("e2e insert failed");

      const profileB = await createProfile(b.id, "default");
      const versionB = await createProfileVersion(profileB.id, b.id, 1);

      await expectPgError(
        db.insert(profileVersionModels).values({
          profileVersionId: versionB.id,
          projectId: b.id,
          modelId: modelA.id,
        }),
        "23503",
      );
      await expectPgError(
        db.insert(profileVersionLibraries).values({
          profileVersionId: versionB.id,
          projectId: b.id,
          libraryId: libraryA.id,
        }),
        "23503",
      );
      await expectPgError(
        db.insert(profileVersionSkills).values({
          profileVersionId: versionB.id,
          projectId: b.id,
          skillVersionId: skillVersionA.id,
        }),
        "23503",
      );
      await expectPgError(
        db.insert(profileVersionInstructions).values({
          profileVersionId: versionB.id,
          projectId: b.id,
          instructionId: instructionA.id,
        }),
        "23503",
      );
      await expectPgError(
        db.insert(profileVersionE2eTests).values({
          profileVersionId: versionB.id,
          projectId: b.id,
          e2eTestId: e2eA.id,
        }),
        "23503",
      );
    });

    it("allows a profile version to reference resources of its own project", async () => {
      const a = await createProject("proj-a");
      const [modelA] = await db
        .insert(models)
        .values({ projectId: a.id, slug: "sonnet", provider: "anthropic", modelId: "claude-sonnet" })
        .returning();
      if (!modelA) throw new Error("model insert failed");

      const profile = await createProfile(a.id, "default");
      const version = await createProfileVersion(profile.id, a.id, 1);

      const linked = await db
        .insert(profileVersionModels)
        .values({ profileVersionId: version.id, projectId: a.id, modelId: modelA.id })
        .returning();
      expect(linked).toHaveLength(1);
    });

    it("allows a profile version to reference its own project's other resources", async () => {
      const a = await createProject("proj-a");

      const [libraryA] = await db
        .insert(libraries)
        .values({ projectId: a.id, slug: "lib", name: "Lib" })
        .returning();
      if (!libraryA) throw new Error("library insert failed");
      const [skillA] = await db
        .insert(skills)
        .values({ projectId: a.id, slug: "s", source: "src", name: "S" })
        .returning();
      if (!skillA) throw new Error("skill insert failed");
      const [skillVersionA] = await db
        .insert(skillVersions)
        .values({ skillId: skillA.id, projectId: a.id, version: 1, skillMd: "# S" })
        .returning();
      if (!skillVersionA) throw new Error("skill version insert failed");
      const [instructionA] = await db
        .insert(instructions)
        .values({ projectId: a.id, slug: "i", name: "I", content: "# I" })
        .returning();
      if (!instructionA) throw new Error("instruction insert failed");
      const [e2eA] = await db
        .insert(e2eTests)
        .values({ projectId: a.id, slug: "e", name: "E", definition: "# E" })
        .returning();
      if (!e2eA) throw new Error("e2e insert failed");

      const profile = await createProfile(a.id, "default");
      const version = await createProfileVersion(profile.id, a.id, 1);

      await db.insert(profileVersionLibraries).values({
        profileVersionId: version.id,
        projectId: a.id,
        libraryId: libraryA.id,
      });
      await db.insert(profileVersionSkills).values({
        profileVersionId: version.id,
        projectId: a.id,
        skillVersionId: skillVersionA.id,
      });
      await db.insert(profileVersionInstructions).values({
        profileVersionId: version.id,
        projectId: a.id,
        instructionId: instructionA.id,
      });
      await db.insert(profileVersionE2eTests).values({
        profileVersionId: version.id,
        projectId: a.id,
        e2eTestId: e2eA.id,
      });

      const links = await Promise.all([
        db.select().from(profileVersionLibraries),
        db.select().from(profileVersionSkills),
        db.select().from(profileVersionInstructions),
        db.select().from(profileVersionE2eTests),
      ]);
      expect(links.map((rows) => rows.length)).toEqual([1, 1, 1, 1]);
    });

    it("allows the same skill (source, slug) in two different projects", async () => {
      const a = await createProject("proj-a");
      const b = await createProject("proj-b");

      const [skillA] = await db
        .insert(skills)
        .values({
          projectId: a.id,
          slug: "code-review",
          source: "github:owner/repo",
          name: "Code Review",
        })
        .returning();
      if (!skillA) throw new Error("skill insert failed");
      const [skillB] = await db
        .insert(skills)
        .values({
          projectId: b.id,
          slug: "code-review",
          source: "github:owner/repo",
          name: "Code Review",
        })
        .returning();
      if (!skillB) throw new Error("skill insert failed");

      expect(skillA.projectId).toBe(a.id);
      expect(skillB.projectId).toBe(b.id);
      expect(skillA.id).not.toBe(skillB.id);
    });
  });

  describe("audit log", () => {
    it("stores configuration mutation records with jsonb details", async () => {
      const p = await createProject("proj-a");
      const profile = await createProfile(p.id, "default");
      const version = await createProfileVersion(profile.id, p.id, 1);

      const [log] = await db
        .insert(auditLogs)
        .values({
          projectId: p.id,
          actor: "user:42",
          action: "profile_version.created",
          resourceType: "profile_version",
          resourceId: version.id,
          details: { version: 1, slug: profile.slug },
        })
        .returning();
      if (!log) throw new Error("audit log insert failed");

      const rows = await db.select().from(auditLogs).where(eq(auditLogs.id, log.id));
      expect(rows[0]?.action).toBe("profile_version.created");
      expect(rows[0]?.details).toEqual({ version: 1, slug: profile.slug });
    });

    it("rejects UPDATE and DELETE on audit log rows (append-only)", async () => {
      const p = await createProject("proj-a");
      const [log] = await db
        .insert(auditLogs)
        .values({
          projectId: p.id,
          actor: "user:42",
          action: "project.created",
          resourceType: "project",
          resourceId: p.id,
        })
        .returning();
      if (!log) throw new Error("audit log insert failed");

      await expectPgError(
        db
          .update(auditLogs)
          .set({ action: "tampered" })
          .where(eq(auditLogs.id, log.id)),
        "P0001",
      );
      await expectPgError(
        db.delete(auditLogs).where(eq(auditLogs.id, log.id)),
        "P0001",
      );
    });

    it("keeps audit history and purges versioned data when a project is deleted", async () => {
      const p = await createProject("proj-a");

      // A realistic project: profile + versions, skill + versions + files,
      // a model, a relationship, and audit entries.
      const profile = await createProfile(p.id, "default");
      const version = await createProfileVersion(profile.id, p.id, 1);

      const [model] = await db
        .insert(models)
        .values({ projectId: p.id, slug: "sonnet", provider: "anthropic", modelId: "claude-sonnet" })
        .returning();
      if (!model) throw new Error("model insert failed");
      await db.insert(profileVersionModels).values({
        profileVersionId: version.id,
        projectId: p.id,
        modelId: model.id,
      });

      const [skill] = await db
        .insert(skills)
        .values({ projectId: p.id, slug: "s", source: "src", name: "S" })
        .returning();
      if (!skill) throw new Error("skill insert failed");
      const [skillVersion] = await db
        .insert(skillVersions)
        .values({ skillId: skill.id, projectId: p.id, version: 1, skillMd: "# S" })
        .returning();
      if (!skillVersion) throw new Error("skill version insert failed");
      await db.insert(skillFiles).values({
        skillVersionId: skillVersion.id,
        path: "run.sh",
        content: "sh",
      });
      await db.insert(profileVersionSkills).values({
        profileVersionId: version.id,
        projectId: p.id,
        skillVersionId: skillVersion.id,
      });

      await db.insert(auditLogs).values({
        projectId: p.id,
        actor: "user:42",
        action: "project.created",
        resourceType: "project",
        resourceId: p.id,
      });

      // The whole project must be purgeable even with immutable version rows.
      await db.delete(projects).where(eq(projects.id, p.id));

      // Audit history survives with project_id set to null.
      const auditRows = await db.select().from(auditLogs);
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.projectId).toBeNull();
      expect(auditRows[0]?.action).toBe("project.created");

      // All versioned + relationship data is gone.
      const [projectCount] = await sql.unsafe<{ n: string }[]>(
        "SELECT count(*) AS n FROM projects",
      );
      const [versionCount] = await sql.unsafe<{ n: string }[]>(
        "SELECT count(*) AS n FROM profile_versions",
      );
      const [skillVersionCount] = await sql.unsafe<{ n: string }[]>(
        "SELECT count(*) AS n FROM skill_versions",
      );
      const [junctionCount] = await sql.unsafe<{ n: string }[]>(
        "SELECT count(*) AS n FROM profile_version_models",
      );
      expect(projectCount?.n).toBe("0");
      expect(versionCount?.n).toBe("0");
      expect(skillVersionCount?.n).toBe("0");
      expect(junctionCount?.n).toBe("0");
    });

    it("blocks plain TRUNCATE of the audit trail unless explicitly allowed", async () => {
      const p = await createProject("proj-a");
      await db.insert(auditLogs).values({
        projectId: p.id,
        actor: "user:42",
        action: "project.created",
        resourceType: "project",
        resourceId: p.id,
      });

      // Use a dedicated single connection so the maintenance GUC is applied to
      // the same session that performs the TRUNCATE (the shared pool may
      // scatter statements across connections).
      const conn = postgres(testDatabaseUrl as string, {
        max: 1,
        prepare: false,
      });
      try {
        // The default session (GUC never set) must also be blocked.
        await expectPgError(
          conn.unsafe("TRUNCATE TABLE audit_logs"),
          "P0001",
        );
        await conn.unsafe("SET app.allow_audit_truncate = 'false'");
        await expectPgError(
          conn.unsafe("TRUNCATE TABLE audit_logs"),
          "P0001",
        );
        // The maintenance path (GUC enabled) still works.
        await conn.unsafe("SET app.allow_audit_truncate = 'true'");
        await conn.unsafe("TRUNCATE TABLE audit_logs");
      } finally {
        await conn.end({ timeout: 5 });
      }
    });
  });

  describe("fresh-database recreation", () => {
    it("applies all migrations cleanly to a brand-new database", async () => {
      const baseUrl = testDatabaseUrl as string;
      const freshName = `agent_defaults_fresh_${Date.now()}`;

      const adminUrl = new URL(baseUrl);
      adminUrl.pathname = "/postgres";
      const admin = postgres(adminUrl.toString(), { max: 1, prepare: false });
      const freshUrl = new URL(baseUrl);
      freshUrl.pathname = `/${freshName}`;

      const fresh = createDb(freshUrl.toString());
      try {
        await admin.unsafe(`CREATE DATABASE "${freshName}"`);
        await migrate(fresh.db, { migrationsFolder });
        const tables = await fresh.sql.unsafe<{ table_name: string }[]>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' ORDER BY table_name`,
        );
        const names = tables.map((t) => t.table_name);
        for (const expected of [
          "projects",
          "profiles",
          "profile_versions",
          "models",
          "libraries",
          "skills",
          "skill_versions",
          "skill_files",
          "instructions",
          "e2e_tests",
          "audit_logs",
        ]) {
          expect(names).toContain(expected);
        }
        expect(names.length).toBeGreaterThanOrEqual(17);
      } finally {
        await fresh.sql.end({ timeout: 5 });
        await admin.unsafe(`DROP DATABASE IF EXISTS "${freshName}"`);
        await admin.end({ timeout: 5 });
      }
    });
  });

});
