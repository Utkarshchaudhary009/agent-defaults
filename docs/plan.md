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

---

# Phase 3 — Profile Management API

## Goal

Expose APIs to create and manage projects, profiles, versions, and profile resources.

## Tasks

- [ ] Implement project endpoints.
- [ ] Implement profile creation.
- [ ] Implement profile retrieval.
- [ ] Implement profile update/version creation.
- [ ] Implement model/provider endpoints.
- [ ] Implement library endpoints.
- [ ] Implement skill endpoints.
- [ ] Implement skill retrieval by stable identifier/source and slug.
- [ ] Implement skill package retrieval including `SKILL.md` and supporting files.
- [ ] Implement Markdown instruction endpoints.
- [ ] Implement E2E test-definition endpoints.
- [ ] Add Zod request/response validation.
- [ ] Define stable API error codes and response shapes.
- [ ] Add OpenAPI documentation.

## Deliverable

A usable API for managing versioned agent profiles without direct database access.

## Verification

- [ ] Integration tests pass for each implemented resource.
- [ ] Invalid payloads return stable validation errors.
- [ ] Unauthorized resource access is denied.
- [ ] Cross-project access is denied.
- [ ] Skill retrieval returns the expected package contents.
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

Resolve a profile into one deterministic, versioned configuration snapshot for an execution client.

## Tasks

- [ ] Define profile-resolution semantics.
- [ ] Implement pinned resolution such as `testing@12`.
- [ ] Implement moving-channel resolution such as `testing@latest`.
- [ ] Resolve model/provider configuration.
- [ ] Resolve libraries.
- [ ] Resolve skills as versioned packages.
- [ ] Resolve Markdown instructions.
- [ ] Resolve E2E test definitions.
- [ ] Define the resolved-configuration response schema.
- [ ] Include profile/version identity in the response.
- [ ] Ensure identical inputs and version produce identical resolved configuration.
- [ ] Exclude provider credentials from resolved profiles.

## Deliverable

One authenticated API request resolves a profile into the complete configuration required by an execution client.

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
