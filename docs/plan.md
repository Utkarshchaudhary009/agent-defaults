# Agent Defaults — Implementation Plan

## Project Goal

Build an API-first control plane for AI-agent configuration used by GitHub Actions and other automated clients.

Centralize model/provider selection, libraries, skills, Markdown instructions, test definitions, execution settings, and future agent-environment configuration behind versioned profiles.

The core client flow is:

```text
request profile → resolve version → receive one deterministic configuration snapshot
```

The first use case is removing duplicated model configuration from GitHub Actions.

## Source-of-Truth Principles

- This plan is the implementation roadmap and verification contract.
- Amend it before implementing material feature, architecture, technology, or verification changes.
- `[x]` means the listed verification actually ran and passed.
- Keep phases small enough to implement, verify, and commit independently.

---

# Phase 1 — Foundation

## Goal

Create the minimal Bun + TypeScript + Hono service with Neon PostgreSQL, Drizzle, Zod, health checking, and project tooling.

## Tasks

- [x] Initialize the Bun + TypeScript project.
- [x] Add Hono.
- [x] Add Drizzle and Neon/PostgreSQL connectivity.
- [x] Add Zod for API-boundary validation.
- [x] Establish source directories for routes, services, database, auth, and configuration.
- [x] Add environment-variable validation without committing secrets.
- [x] Create the migration workflow.
- [x] Add `/health`.
- [x] Add typecheck and lint/format scripts.
- [x] Add Vitest.

## Deliverable

A runnable Hono API with Neon connectivity and passing developer checks.

## Verification

- [x] Typecheck passes.
- [x] Lint/format checks pass.
- [x] Unit test suite passes.
- [x] API starts successfully.
- [x] `/health` returns the documented response.
- [x] Database connection and migration path work in a safe development environment.

---

# Phase 2 — Core Data Model

## Goal

Model projects, profiles, immutable profile versions, and reusable agent resources.

## Tasks

- [x] Define project ownership and isolation.
- [x] Define profiles within projects.
- [x] Define immutable profile versions.
- [x] Define model/provider resources.
- [x] Define library resources.
- [x] Define skill resources as versioned packages containing `SKILL.md` and optional supporting files.
- [x] Define a stable skill identifier and source reference suitable for CLI retrieval, including source/repository plus skill slug where applicable.
- [x] Define Markdown instruction resources.
- [x] Define E2E test definitions.
- [x] Define profile-to-resource relationships.
- [x] Define audit-log storage for configuration mutations.
- [x] Add uniqueness and isolation constraints.
- [x] Create migrations.

## Deliverable

A normalized PostgreSQL schema for versioned agent profiles and their resources.

## Verification

- [x] Migrations apply cleanly.
- [x] Fresh test database can recreate the schema.
- [x] Schema constraints are tested.
- [x] Profile/version persistence tests pass.
- [x] Skill package persistence tests cover `SKILL.md`, supporting files, version, and stable identifier.
- [x] Cross-project isolation tests pass.

## Design note: deletion semantics

Immutable version rows (`profile_versions`, `skill_versions`, `skill_files`) and
their junction links are cascade-deletable when an *owning project* is deleted:
the parent FKs are upgraded to `ON DELETE CASCADE` (migration `0004`) and the
immutability triggers only reject **direct** client DML (they allow writes that
arrive from a parent cascade, detected via `pg_trigger_depth()`). A project's
audit history is preserved across deletion via `ON DELETE SET NULL`.
`audit_logs` is append-only and also rejects `TRUNCATE` unless the session
enables `app.allow_audit_truncate` (the sanctioned maintenance path).

---

# Phase 3 — Profile Management API and Draft/Publish Lifecycle

## Goal

Expose APIs to create and manage projects, profiles, versions, and profile
resources, and add the **draft → publish** lifecycle that seals a version's
resource relationships and supporting files after publication.

## Design note: draft → publish lifecycle

Profile and skill versions are created in the `draft` state and may be edited
freely while drafting: the `profile_versions` / `skill_versions` row itself
can be retitled, its junction rows (`profile_version_models`,
`profile_version_libraries`, `profile_version_skills`,
`profile_version_instructions`, `profile_version_e2e_tests`) can be added or
removed, and a `skill_versions` row's `skill_files` can be added or removed.

A version transitions to `published` via the version endpoint. On publish:

- The version row is sealed — UPDATE and DELETE on `profile_versions` /
  `skill_versions` continue to raise (depth-aware, so a project purge still
  works).
- The version's junction rows are sealed — INSERT, UPDATE, and DELETE on
  every `profile_version_*` junction table for that version raise.
- The version's `skill_files` are sealed — INSERT, UPDATE, and DELETE raise.

Once published, any change to a version's contents requires a new version
(via a new draft). `skill_versions` may also be explicitly deprecated (a
`deprecated` flag on the parent `skills` row is independent of version state).

## Typical agent flow (canonical happy path)

The most common call sequence for an agent that wants to set up a project
end-to-end. The same sequence applies to human authors via a UI; it is
optimised for being executable as a script with no branching.

```text
1.  POST   /v1/projects                              → projectId
2.  POST   /v1/projects/{projectId}/models            → modelId     (one per provider)
3.  POST   /v1/projects/{projectId}/libraries         → libraryId   (optional)
4.  POST   /v1/projects/{projectId}/skills            → skillId
5.  POST   /v1/projects/{projectId}/skills/{skillId}/versions
                                                    → skillVersionId  (auto-draft)
6.  PUT    /v1/projects/{projectId}/skills/{skillId}/versions/{skillVersionId}/files/{path}
                                                    → 204 (one per supporting file)
7.  POST   /v1/projects/{projectId}/skills/{skillId}/versions/{skillVersionId}/publish
                                                    → 204 (seals the skill package)
8.  POST   /v1/projects/{projectId}/profiles          → profileId
9.  POST   /v1/projects/{projectId}/profiles/{profileId}/versions
                                                    → versionId   (auto-draft, version=1)
10. POST   /v1/projects/{projectId}/profiles/{profileId}/versions/{versionId}/models
                                                    → 204
11. POST   /v1/projects/{projectId}/profiles/{profileId}/versions/{versionId}/skills
                                                    → 204
12. POST   /v1/projects/{projectId}/profiles/{profileId}/versions/{versionId}/publish
                                                    → 204  (seals the profile version)
13. GET    /v1/projects/{projectId}/profiles/{profileId}@1     (Phase 5 — resolve)
```

To change anything in a published version: create a new draft (step 9 with
`version=2`), repeat the junction calls for the changed refs, and publish.
Never edit a published version directly — it is sealed by design.

## Tasks

Each task below is a single API endpoint. The **Suggested flow** line
answers (a) when to call it, (b) what the one or two expected errors are,
and (c) the next canonical call.

- [ ] **Project endpoints.** `POST /v1/projects`, `GET /v1/projects/{projectId}`,
      `GET /v1/projects?slug=...`, `DELETE /v1/projects/{projectId}`.
      *Suggested flow*: call `POST /v1/projects` once at the start of setup
      (step 1). If you receive `409 project_slug_taken`, the project already
      exists — call `GET /v1/projects?slug=...` and reuse the returned id.
      `DELETE` is rarely called; it cascades to every resource and audit row
      gets `project_id` set to `NULL` (history preserved).

- [ ] **Profile creation.** `POST /v1/projects/{projectId}/profiles`,
      `GET /v1/projects/{projectId}/profiles/{profileId}`,
      `GET /v1/projects/{projectId}/profiles?slug=...`.
      *Suggested flow*: call `POST .../profiles` once per profile (step 8).
      On `409 profile_slug_taken`, look up the existing id via the slug GET
      and continue.

- [ ] **Profile retrieval.** `GET /v1/projects/{projectId}/profiles/{profileId}`.
      *Suggested flow*: use this to confirm the latest version number before
      creating a new version; the response includes the highest published
      version.

- [ ] **Profile update / version creation.**
      `POST /v1/projects/{projectId}/profiles/{profileId}/versions` (creates
      a new draft version, version number is server-assigned, default
      `version=last+1` if not specified).
      `PATCH /v1/projects/{projectId}/profiles/{profileId}/versions/{versionId}`
      (update notes on a draft).
      *Suggested flow*: this is the "create v2" call after a published v1
      needs changes. On `409 version_already_exists` (you tried to specify
      the version number explicitly and it is taken), omit the version field
      and let the server pick the next one.

- [ ] **Version publish.**
      `POST /v1/projects/{projectId}/profiles/{profileId}/versions/{versionId}/publish`.
      *Suggested flow*: call this once the draft has every junction you want
      (steps 10–11). If you receive `409 version_already_published`, the
      version is sealed — you are looking at a stale draft id; `GET` the
      profile to find the latest published version. If you receive
      `409 version_has_no_resources`, you are trying to publish an empty
      profile; add at least one model or skill junction first.

- [ ] **Model / provider endpoints.** `POST /v1/projects/{projectId}/models`,
      `GET /v1/projects/{projectId}/models/{modelId}`,
      `GET /v1/projects/{projectId}/models?slug=...`.
      *Suggested flow*: create the model once per project (step 2), then
      reference it from any version junction (step 10). Reuse the same
      model across versions.

- [ ] **Library endpoints.** `POST /v1/projects/{projectId}/libraries`,
      `GET /v1/projects/{projectId}/libraries/{libraryId}`,
      `GET /v1/projects/{projectId}/libraries?slug=...`,
      `POST /v1/.../profiles/{profileId}/versions/{versionId}/libraries`.
      *Suggested flow*: create once (step 3), attach per version
      (parallel to step 10).

- [ ] **Skill endpoints.** `POST /v1/projects/{projectId}/skills`,
      `GET /v1/projects/{projectId}/skills/{skillId}`,
      `GET /v1/projects/{projectId}/skills?source=...&slug=...`
      (the stable identifier lookup).
      *Suggested flow*: create the skill identity once (step 4) and re-use
      across versions. The stable identifier is `(source, slug)` — agents
      that only know the source/slug can resolve to a skillId before
      creating versions.

- [ ] **Skill version creation / update / publish.**
      `POST /v1/projects/{projectId}/skills/{skillId}/versions` (auto-draft),
      `PUT /v1/.../skills/{skillId}/versions/{skillVersionId}/files/{path}`
      (upsert one supporting file),
      `DELETE /v1/.../skills/{skillId}/versions/{skillVersionId}/files/{path}`,
      `POST /v1/.../skills/{skillId}/versions/{skillVersionId}/publish`.
      *Suggested flow*: steps 5–7. Use `PUT` (idempotent) for files; do not
      use `POST`. A skill version can be published without any files, but
      agents should publish only when they have written the files they
      intend to ship.

- [ ] **Skill retrieval by stable identifier.**
      `GET /v1/projects/{projectId}/skills?source=...&slug=...&version=...`.
      *Suggested flow*: when an agent only knows `source` + `slug`, this
      resolves to a `skillId` + a version. Default to the latest published
      version; pin a specific version number for reproducibility.

- [ ] **Skill package retrieval.**
      `GET /v1/projects/{projectId}/skills/{skillId}/versions/{skillVersionId}`
      (returns `SKILL.md` + file manifest),
      `GET /v1/.../skills/{skillId}/versions/{skillVersionId}/files/{path}`
      (returns the file content).
      *Suggested flow*: this is the read path; pair it with the Phase 5
      resolution response. Use this when an agent needs the full package
      outside a profile (e.g. for a one-off skill).

- [ ] **Markdown instruction endpoints.**
      `POST /v1/projects/{projectId}/instructions`,
      `GET /v1/projects/{projectId}/instructions/{instructionId}`,
      `GET /v1/projects/{projectId}/instructions?slug=...`,
      `POST /v1/.../profiles/{profileId}/versions/{versionId}/instructions`.
      *Suggested flow*: create the instruction once per project, attach per
      version. Same idempotency rules as libraries.

- [ ] **E2E test-definition endpoints.**
      `POST /v1/projects/{projectId}/e2e-tests`,
      `GET /v1/projects/{projectId}/e2e-tests/{e2eId}`,
      `GET /v1/projects/{projectId}/e2e-tests?slug=...`,
      `POST /v1/.../profiles/{profileId}/versions/{versionId}/e2e-tests`.
      *Suggested flow*: same shape as instructions. Validation of the
      `E2E.md` body is defined in Phase 7; the API only stores the raw
      markdown in Phase 3.

- [ ] Add Zod request/response validation at the API boundary.
- [ ] Define stable API error codes and response shapes (see the failure
      recovery matrix at the end of this phase).
- [ ] Add OpenAPI documentation.

## Deliverable

A usable API for managing versioned agent profiles without direct database access.

## Failure recovery matrix

The most likely error codes an agent will encounter, paired with the next
call. Anything not in this matrix is a bug; do not invent recovery paths
in the client.

| HTTP | Code                          | Likely cause                          | Next call to make                                            |
|------|-------------------------------|---------------------------------------|--------------------------------------------------------------|
| 400  | `validation_failed`           | Request body missing required field   | Fix the body and retry the same endpoint.                    |
| 401  | `unauthenticated`             | Missing / expired credential          | Re-authenticate (Phase 4) and retry.                         |
| 403  | `cross_project_access`        | Path projectId does not match token   | Stop. The token is for a different project; do not retry.    |
| 403  | `forbidden`                   | Resource not authorized for this actor| Stop. Surface to the operator; do not retry.                 |
| 404  | `project_not_found`           | Bad projectId                         | `GET /v1/projects?slug=...` to look up by slug.              |
| 404  | `profile_not_found`           | Bad profileId                         | `GET /v1/projects/{projectId}/profiles?slug=...`.            |
| 404  | `version_not_found`           | Bad versionId                         | `GET /v1/.../profiles/{profileId}` to list versions.         |
| 404  | `resource_not_found`          | Bad modelId / libraryId / skillId     | `GET ...?slug=...` to look up by slug.                       |
| 409  | `project_slug_taken`          | Slug already used                     | `GET /v1/projects?slug=...` and reuse the returned id.       |
| 409  | `profile_slug_taken`          | Slug already used in this project     | `GET /v1/.../profiles?slug=...` and reuse.                   |
| 409  | `resource_slug_taken`         | Slug already used in this project     | `GET ...?slug=...` to resolve; reuse the id.                 |
| 409  | `version_already_exists`      | Explicit version number is taken      | Omit the version field; the server picks the next number.    |
| 409  | `version_already_published`   | Publish on a non-draft version        | `GET /v1/.../profiles/{profileId}` to find the latest.       |
| 409  | `version_has_no_resources`    | Publish on a draft with no junctions  | Add at least one junction (model/skill/library) and retry.   |
| 422  | `invalid_status_transition`   | Flipping a published version to draft | Create a new version (POST .../versions) instead.             |
| 5xx  | `internal_error`              | Server fault                          | Retry with exponential backoff up to 3 times; then surface.  |

## Verification

- [ ] Integration tests pass for each implemented resource.
- [ ] Invalid payloads return stable validation errors.
- [ ] Unauthorized resource access is denied.
- [ ] Cross-project access is denied.
- [ ] Skill retrieval returns the expected package contents.
- [ ] Draft profile/skill versions can be edited (junctions, files, row).
- [ ] Publishing a version seals its junctions and files.
- [ ] Published versions cannot be mutated (junctions, files, or row).
- [ ] A project purge still cascades through published versions.
- [ ] OpenAPI matches the implemented API.
- [ ] E2E testing of API endpoints only passes for the implemented surface.

---

# Phase 4 — Authentication and Authorization

## Goal

Secure human access and GitHub Actions access without unnecessary long-lived credentials.

## Tasks

- [ ] Implement GitHub OAuth for human management access.
- [ ] Define user/session handling.
- [ ] Implement GitHub OIDC verification for Actions.
- [ ] Validate trusted GitHub identity claims.
- [ ] Map repositories to projects.
- [ ] Define profile/resource authorization.
- [ ] Apply authorization to protected endpoints.
- [ ] Add security-sensitive audit events.

## Deliverable

Humans can manage authorized projects, and GitHub Actions can authenticate through OIDC and access only explicitly authorized resources.

## Verification

- [ ] Valid human authentication succeeds.
- [ ] Invalid/expired human sessions are rejected.
- [ ] Valid GitHub OIDC identity is accepted.
- [ ] Invalid or expired OIDC identity is rejected.
- [ ] Unauthorized repositories are rejected.
- [ ] Authorized repositories can access allowed profiles.
- [ ] Cross-project access is rejected.
- [ ] E2E testing of authenticated API endpoints only passes for authorized paths and rejects unauthorized paths.
- [ ] Credentials are absent from logs and API responses.

---

# Phase 5 — Profile Resolution API

## Goal

Resolve a profile into one deterministic, versioned configuration snapshot
for an execution client.

## Typical agent flow

This is the read path that the GitHub Action (Phase 6) and any other
execution client will use on every run. It is intentionally a single
request with a single response — no choreography.

```text
1. GET   /v1/resolve/{projectId}/profiles/{slug}@{versionPin}
                                              → resolved config snapshot
```

The `{versionPin}` is either a literal version number (`12`) or the literal
`latest`. The response includes the resolved profile + version identity
plus the full configuration the agent needs (model, libraries, skills as
versioned packages, instructions, E2E contracts). No follow-up calls are
required for normal execution.

If the agent only has a skill's stable identifier (no profile context),
it can use the Phase 3 skill retrieval endpoint instead.

## Tasks

Each task below is a single API surface. The **Suggested flow** line
answers (a) when to call it, (b) what the one or two expected errors are,
and (c) the next call in the canonical path.

- [ ] **Define profile-resolution semantics.** A `slug@versionPin` resolves
      to one immutable snapshot. `latest` resolves to the highest
      *published* version number. A draft is not addressable by `latest`
      and cannot be resolved — drafts are authoring state, not runtime
      state.
      *Suggested flow*: pin to a number for reproducible runs; use
      `latest` for the moving channel (rolling upgrade).

- [ ] **Pinned resolution.** `GET /v1/resolve/{projectId}/profiles/{slug}@{versionNumber}`.
      *Suggested flow*: the GitHub Action pins to a literal version by
      default. On `404 version_not_found` (the version number does not
      exist), the action fails closed — do not fall back to `latest`
      silently.

- [ ] **Moving-channel resolution.** `GET /v1/resolve/{projectId}/profiles/{slug}@latest`.
      *Suggested flow*: human-driven local runs use `@latest`. Same
      `404` semantics if there is no published version.

- [ ] **Resolve model / provider configuration.** Included in the
      resolved response; no separate call.
- [ ] **Resolve libraries.** Same — included in the response.
- [ ] **Resolve skills as versioned packages.** Each skill in the response
      includes `SKILL.md` content and the file manifest, so the agent can
      materialize the package without further API calls.
- [ ] **Resolve Markdown instructions.** Inlined as `content` in the
      response.
- [ ] **Resolve E2E test definitions.** Inlined as `definition` in the
      response.
- [ ] **Define the resolved-configuration response schema.** Versioned,
      includes `profileId`, `slug`, `version`, `versionId`, `publishedAt`,
      and the resolved resources. Stable across releases; additions are
      additive only.
- [ ] **Include profile / version identity in the response.** The caller
      echoes it back in logs and audit trails; this is the
      reproducibility anchor.
- [ ] **Ensure identical inputs and version produce identical resolved
      configuration.** The response is a pure function of the published
      version row. No timestamps from the resolution call leak into
      payload content.
- [ ] **Exclude provider credentials from resolved profiles.** Resolution
      returns model identity, never API keys. The execution client uses
      its own secret store; Phase 8 will define the integration.

## Deliverable

One authenticated API request resolves a profile into the complete
configuration required by an execution client.

## Failure recovery matrix

| HTTP | Code                          | Likely cause                          | Next call to make                                            |
|------|-------------------------------|---------------------------------------|--------------------------------------------------------------|
| 400  | `invalid_version_pin`         | `@latest` or `@12` is malformed       | Fix the URL; do not retry.                                   |
| 401  | `unauthenticated`             | Missing / expired credential          | Re-authenticate (Phase 4) and retry.                         |
| 403  | `cross_project_access`        | Path projectId does not match token   | Stop. The token is for a different project.                  |
| 404  | `profile_not_found`           | Unknown slug                          | `GET /v1/projects/{projectId}/profiles?slug=...`.            |
| 404  | `version_not_found`           | Pinned number does not exist          | Fail closed. Do not fall back to `@latest`.                  |
| 404  | `no_published_version`        | `@latest` requested before publish    | `POST .../versions` to create and publish a version.         |
| 409  | `profile_has_no_resources`    | Published version has no junctions    | `POST .../versions` to create a new draft with resources.    |
| 5xx  | `internal_error`              | Server fault                          | Retry with exponential backoff up to 3 times; then surface.  |

## Verification

- [ ] Pinned versions resolve consistently.
- [ ] `latest` resolves to the expected version.
- [ ] Resource relationships resolve correctly.
- [ ] Skill package versions resolve to the expected `SKILL.md` and supporting files.
- [ ] Cross-project resources cannot resolve.
- [ ] Existing immutable versions never change after later edits.
- [ ] E2E testing of the profile-resolution API only passes with the expected snapshot contract.

---

# Phase 6 — GitHub Action Client

## Goal

Create a thin GitHub Action that authenticates through OIDC, requests a profile, and exposes the resolved configuration without embedding model decisions.

## Tasks

- [ ] Create the TypeScript GitHub Action package.
- [ ] Request a GitHub OIDC identity token.
- [ ] Authenticate with the profile-resolution API.
- [ ] Add a profile input interface.
- [ ] Materialize resources required by the resolved profile.
- [ ] Expose the resolved profile to subsequent steps.
- [ ] Produce structured execution logs.
- [ ] Handle API, authentication, and resolution failures.
- [ ] Keep model/provider selection out of Action code.

## Deliverable

A repository can consume a central profile with a minimal workflow configuration such as `profile: testing`.

## Verification

- [ ] Action builds successfully.
- [ ] Action authenticates in a GitHub Actions environment.
- [ ] Authorized repository resolves its profile.
- [ ] Unauthorized repository is rejected.
- [ ] Resolved configuration is available to subsequent steps.
- [ ] E2E testing of the GitHub Action → API flow only passes for authorized and expected configuration paths.
- [ ] Failure output is structured and actionable.

---

# Phase 7 — Agent Resource and E2E System

## Goal

Make skills, Markdown instructions, and E2E definitions usable as agent-environment resources.

## Tasks

- [ ] Define reusable skill conventions compatible with `SKILL.md` plus optional supporting files.
- [ ] Define Markdown instruction metadata.
- [ ] Define `E2E.md` semantics and execution contract.
- [ ] Define environment requirements, commands, success criteria, and artifact boundaries for E2E definitions.
- [ ] Implement resource retrieval through the API.
- [ ] Implement required resource versioning/immutability.
- [ ] Add representative autonomous-testing examples.
- [ ] Define result reporting boundaries.

## Deliverable

An execution client can retrieve model selection plus reusable skills, instructions, and E2E test contracts from one profile.

## Verification

- [ ] Skill retrieval tests pass.
- [ ] Markdown instruction retrieval tests pass.
- [ ] E2E definition validation tests pass.
- [ ] E2E testing of the API-only resource retrieval flow passes.
- [ ] A real test environment consumes an E2E definition successfully.
- [ ] Failure and artifact behavior are verified.

---

# Phase 8 — Hardening

## Goal

Make the control plane safe and stable as a shared dependency across repositories and workflows.

## Tasks

- [ ] Add rate limiting appropriate to the API surface.
- [ ] Add request IDs and structured server logging.
- [ ] Add useful audit-log queries.
- [ ] Define API compatibility/versioning policy.
- [ ] Add profile rollback/version selection.
- [ ] Add configuration diffs between profile versions.
- [ ] Strengthen repository/project management workflows.
- [ ] Publish API and Action documentation.
- [ ] Add CI coverage for API and Action packages.
- [ ] Review the threat model and least-privilege assumptions.

## Deliverable

A stable API-first control plane suitable for multiple repositories and AI-agent workflows.

## Verification

- [ ] Full test suite passes.
- [ ] Typecheck and lint/format checks pass.
- [ ] Security and authorization tests pass.
- [ ] E2E testing of the API-only production flow passes.
- [ ] Version rollback is verified.
- [ ] Multi-project isolation is verified end to end.
- [ ] Documentation matches implemented behavior.

---

# Future Work — Not Yet Scheduled

- [ ] Additional execution clients beyond GitHub Actions.
- [ ] CLI management client.
- [ ] SDKs for other languages.
- [ ] Additional provider secret-management integrations.
- [ ] Advanced policy engines.
- [ ] Usage/cost accounting.
- [ ] Webhooks/event-driven configuration updates.
- [ ] Remote execution infrastructure.
- [ ] Multi-region deployment.

Do not implement future work without a scheduled phase and concrete requirement.
