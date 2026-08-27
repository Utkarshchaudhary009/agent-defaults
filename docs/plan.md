# Agent Defaults — Implementation Plan

## Project Goal

Build an API-first control plane for AI-agent configuration used by GitHub Actions and other automated clients.

The platform centralizes decisions that would otherwise be duplicated across workflows: model/provider selection, libraries, skills, Markdown instructions, test definitions, execution settings, and other agent-environment configuration.

The core user experience should allow a client to request a named profile and receive one deterministic, versioned configuration snapshot.

The first concrete use case is eliminating duplicated model configuration across GitHub Actions: workflows depend on a profile such as `testing` or `coding`, while the central platform controls which model that profile currently resolves to.

## Source-of-Truth Principles

- This plan is the implementation roadmap and verification contract.
- Amend it before implementing material architectural or requirement changes.
- A checkbox is only checked after the associated verification actually ran and passed.
- Keep phases small enough that each can be implemented, tested, and committed independently.

---

# Phase 1 — Foundation

## Goal

Create the minimal TypeScript/Bun/Hono service foundation with Neon PostgreSQL connectivity, Drizzle migrations, validation, health checks, and a maintainable project structure.

## Tasks

- [ ] Initialize the Bun + TypeScript project.
- [ ] Add Hono as the HTTP framework.
- [ ] Add Drizzle ORM and PostgreSQL/Neon database connectivity.
- [ ] Add Zod for boundary validation.
- [ ] Establish source directories for routes, domain services, database, auth, and configuration.
- [ ] Add environment-variable validation without committing secrets.
- [ ] Create a database migration workflow.
- [ ] Add a basic `/health` endpoint.
- [ ] Add lint/format and typecheck scripts.
- [ ] Add the initial test setup with Vitest.

## Deliverable

A runnable Hono API connected to Neon through a clean data-access layer, with a passing health endpoint and developer checks.

## Verification

- [ ] Typecheck passes.
- [ ] Lint/format checks pass.
- [ ] Unit test suite passes.
- [ ] Local API starts successfully.
- [ ] `/health` returns the documented response.
- [ ] Database connection and migration path are verified in a safe development environment.

---

# Phase 2 — Core Data Model

## Goal

Model projects, profiles, profile versions, and the reusable resources that profiles can reference.

## Tasks

- [ ] Define project ownership and identity boundaries.
- [ ] Define profiles as named resources within a project.
- [ ] Define immutable profile versions.
- [ ] Define models/providers.
- [ ] Define libraries.
- [ ] Define skills.
- [ ] Define Markdown instructions/resources.
- [ ] Define test/E2E definitions.
- [ ] Define profile-to-resource relationships.
- [ ] Define audit-log storage for configuration mutations.
- [ ] Add database constraints needed for uniqueness and isolation.
- [ ] Create and test migrations.

## Deliverable

A normalized PostgreSQL schema capable of representing a versioned agent profile and its related resources.

## Verification

- [ ] Migrations apply cleanly.
- [ ] Migrations can be safely recreated in a fresh test database.
- [ ] Schema constraints are tested.
- [ ] Profile/version persistence tests pass.
- [ ] Cross-project resource isolation tests pass.

---

# Phase 3 — Profile Management API

## Goal

Expose API endpoints for creating, reading, updating, and versioning profiles and their configuration resources.

## Tasks

- [ ] Implement project resource endpoints.
- [ ] Implement profile creation endpoint.
- [ ] Implement profile retrieval endpoint.
- [ ] Implement profile update/version-creation behavior.
- [ ] Implement model/provider management endpoints.
- [ ] Implement library management endpoints.
- [ ] Implement skill management endpoints.
- [ ] Implement instruction/Markdown resource endpoints.
- [ ] Implement E2E/test-definition endpoints.
- [ ] Add request/response validation with Zod.
- [ ] Define stable API error codes and response shapes.
- [ ] Document the public API with OpenAPI.

## Deliverable

A usable API for building and managing versioned agent profiles without direct database access.

## Verification

- [ ] CRUD/integration tests pass for each implemented resource.
- [ ] Invalid payloads return stable validation errors.
- [ ] Unauthorized resource access is denied.
- [ ] Cross-project access is denied.
- [ ] OpenAPI description matches the implemented endpoints.

---

# Phase 4 — Authentication and Authorization

## Goal

Secure human and GitHub Actions access without distributing long-lived credentials unnecessarily.

## Tasks

- [ ] Implement GitHub OAuth-based human authentication for management access.
- [ ] Define user/session handling.
- [ ] Implement GitHub OIDC verification for GitHub Actions clients.
- [ ] Extract and validate trusted GitHub identity claims.
- [ ] Establish repository-to-project authorization mapping.
- [ ] Establish profile/resource authorization rules.
- [ ] Add least-privilege authorization checks to protected endpoints.
- [ ] Prevent tokens and secrets from appearing in logs/errors.
- [ ] Add audit logging for authentication-sensitive and authorization-sensitive events.

## Deliverable

Human users can manage authorized projects, while GitHub Actions can authenticate through OIDC and access only the resources explicitly authorized for their repository/project.

## Verification

- [ ] Valid human authentication path passes.
- [ ] Invalid/expired human session path is rejected.
- [ ] Valid GitHub OIDC identity is accepted.
- [ ] Invalid OIDC token is rejected.
- [ ] Unauthorized repository is rejected.
- [ ] Authorized repository can access its allowed project/profile.
- [ ] Cross-project access is rejected.
- [ ] Sensitive credentials do not appear in logs or API responses.

---

# Phase 5 — Profile Resolution API

## Goal

Create the central capability that resolves a profile into one deterministic configuration snapshot for an execution client.

## Tasks

- [ ] Define profile resolution semantics.
- [ ] Implement pinned version resolution such as `testing@12`.
- [ ] Implement moving-channel resolution such as `testing@latest`.
- [ ] Resolve model/provider configuration.
- [ ] Resolve libraries.
- [ ] Resolve skills.
- [ ] Resolve Markdown instructions.
- [ ] Resolve test/E2E definitions.
- [ ] Return a stable resolved-configuration schema.
- [ ] Include profile/version identity in the response.
- [ ] Ensure the resolved result is deterministic for a given version.
- [ ] Avoid exposing provider credentials in the resolved profile.

## Deliverable

A single authenticated API request can resolve a profile into all configuration required by an execution client.

## Verification

- [ ] Pinned profile versions resolve consistently.
- [ ] `latest` resolves to the expected version.
- [ ] Resource relationships resolve correctly.
- [ ] Two projects cannot resolve each other's resources.
- [ ] A configuration change creates a new version rather than silently mutating an existing immutable version.
- [ ] Real HTTP requests verify the end-to-end resolution contract.

---

# Phase 6 — GitHub Action Client

## Goal

Create a thin, reusable GitHub Action that authenticates with GitHub OIDC, requests a profile, and prepares the execution environment without embedding project-specific model/configuration decisions.

## Tasks

- [ ] Create the TypeScript GitHub Action package.
- [ ] Request an OIDC identity token from GitHub Actions.
- [ ] Authenticate against the profile-resolution API.
- [ ] Add a simple profile input interface.
- [ ] Resolve and materialize libraries/resources required by the returned profile.
- [ ] Expose the resolved profile to later execution steps in a stable format.
- [ ] Produce structured logs suitable for both humans and agents.
- [ ] Handle API/authentication/configuration failures with actionable errors.
- [ ] Ensure the Action itself does not contain hard-coded model/provider decisions.

## Deliverable

A repository can consume a central profile with a minimal workflow configuration such as `profile: testing`.

## Verification

- [ ] Action builds successfully.
- [ ] Action can authenticate from a GitHub Actions environment.
- [ ] Authorized repository resolves its profile.
- [ ] Unauthorized repository is rejected.
- [ ] Resolved configuration is available to subsequent steps.
- [ ] Failure output is structured and actionable.

---

# Phase 7 — Agent Resource and E2E System

## Goal

Turn skills, Markdown instructions, and E2E definitions into first-class agent-environment resources that can drive autonomous testing and other execution workflows.

## Tasks

- [ ] Define the schema and conventions for reusable skills.
- [ ] Define Markdown instruction resource metadata.
- [ ] Define `E2E.md` semantics and execution contract.
- [ ] Define how an E2E definition references environment requirements, commands, success criteria, and artifacts.
- [ ] Implement resource retrieval through the API.
- [ ] Implement resource versioning/immutability where required.
- [ ] Add representative autonomous testing examples.
- [ ] Define artifact/result reporting boundaries.

## Deliverable

An execution client can obtain a complete profile containing model selection plus reusable skills, instructions, and E2E test contracts.

## Verification

- [ ] Skill retrieval tests pass.
- [ ] Markdown instruction retrieval tests pass.
- [ ] E2E definition validation tests pass.
- [ ] A real test environment consumes an E2E definition successfully.
- [ ] Failure and artifact behavior are verified.

---

# Phase 8 — Hardening and Developer Experience

## Goal

Make the platform safe and pleasant to operate as a central dependency across multiple repositories and workflows.

## Tasks

- [ ] Add rate limiting appropriate to the API surface.
- [ ] Add request IDs and structured server logging.
- [ ] Add audit-log querying where operationally useful.
- [ ] Add API compatibility/versioning policy.
- [ ] Add profile rollback/version selection operations.
- [ ] Add configuration diffing between profile versions.
- [ ] Add stronger repository/project management workflows.
- [ ] Publish reusable API and Action documentation.
- [ ] Add CI coverage for API and Action packages.
- [ ] Review threat model and least-privilege assumptions.

## Deliverable

A production-ready API-first control plane suitable for being shared by multiple GitHub repositories and AI-agent workflows.

## Verification

- [ ] Full test suite passes.
- [ ] Typecheck and lint/format checks pass.
- [ ] Security/authorization test suite passes.
- [ ] Version rollback is verified.
- [ ] Multi-project isolation is verified end to end.
- [ ] Documentation matches the implemented API and Action behavior.

---

# Future Work — Not Yet Scheduled

These ideas are intentionally outside the initial implementation until a concrete requirement justifies them:

- [ ] Additional execution clients beyond GitHub Actions.
- [ ] CLI management client.
- [ ] SDKs for other languages.
- [ ] More provider-specific secret management integrations.
- [ ] Advanced policy engines.
- [ ] Usage/cost accounting.
- [ ] Webhooks/event-driven configuration updates.
- [ ] Remote execution infrastructure.
- [ ] Multi-region deployment.

Do not implement future work merely because the schema or architecture could support it.
