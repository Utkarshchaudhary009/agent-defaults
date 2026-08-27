# Agent Defaults — Agent Instructions

## 0 · Golden Rules (read this first)

1. **Plan-as-code:** `docs/plan.md` is the single source of truth for what this project should build and in what order.
2. **Plan first:** material architectural or feature changes must be reflected in `docs/plan.md` before implementation begins.
3. **Evidence over assumption:** `[x]` means the corresponding verification actually ran and passed. Never mark work complete from reasoning alone.
4. **Smallest viable change:** implement only the current phase. Do not build speculative later-phase features.
5. **API-first:** this project has no required frontend. The API and its contracts are the primary product surface.
6. **Security is part of correctness:** authentication, authorization, secret handling, tenant isolation, and configuration exposure must be designed and tested deliberately.

## 1 · Source-of-Truth Protocol

Before writing code:

1. Read `docs/plan.md`.
2. Find the first phase containing unchecked tasks.
3. Read that phase's goal, tasks, deliverable, and verification criteria.
4. Work only within that phase unless the plan is amended first.

When a requirement changes, amend the plan before implementing it. Keep amendments atomic and written so a fresh agent can continue from the plan alone.

## 2 · Development Loop

Every phase follows:

```text
Inspect → Implement → Verify → Sync → Commit
```

### Inspect

- Read the current phase completely.
- Survey the repository before creating new abstractions.
- Reuse established project patterns where they fit.
- Confirm the requested behavior is actually in the plan.

### Implement

- Build only the current phase.
- Prefer small, composable modules.
- Keep API contracts explicit and stable.
- Avoid coupling the core domain to deployment-specific details.

### Verify

At minimum, run the checks appropriate to the current change:

- Typecheck.
- Lint/format checks.
- Relevant unit/integration tests.
- Phase-specific verification from `docs/plan.md`.
- Authentication changes: test authorized and unauthorized paths.
- Authorization changes: test cross-project/cross-repository denial paths.
- API changes: test the real HTTP request/response contract.
- Configuration resolution changes: test deterministic versioned resolution.

If verification is blocked by the environment, leave the checkbox unchecked and record the exact limitation.

### Sync

Only after successful verification:

- Update `docs/plan.md` checkboxes.
- Keep the plan synchronized with the verified repository state.
- Never mark an entire phase complete while required tasks or verification items remain unchecked.

### Commit

Use focused commits tied to a phase or tightly related concern. Preferred format:

```text
phase N: <short description>
```

Documentation-only progress commits may use:

```text
docs: update phase N progress
```

Never commit secrets, tokens, private keys, `.env` files, or database credentials.

## 3 · Architecture Rules

### API-first

The project exposes functionality through an HTTP API. Do not introduce a frontend as a core dependency.

Core shape:

```text
GitHub Action / CLI / SDK / other client
                 ↓
              Hono API
                 ↓
           Domain services
                 ↓
        PostgreSQL via Neon
```

The action, SDK, or CLI must not need to know the internal database schema.

### Hono

Use Hono for the HTTP layer unless the plan explicitly changes the framework.

Keep route handlers thin. Business rules belong in services/domain modules, not directly inside route handlers.

### Neon / PostgreSQL

Neon PostgreSQL is the system's persistent data store.

Use migrations and explicit schemas. Prefer relational modeling for identities, projects, profiles, versions, relationships, and audit records. Use JSON/JSONB only where the data is intentionally flexible.

### Versioned configuration

Profiles are versioned resources.

A resolved configuration must be tied to a specific profile version so an agent run cannot silently change behavior because somebody edited the current profile during execution.

Support an explicit distinction between:

- a requested profile such as `testing`
- a pinned version such as `testing@12`
- a moving channel such as `testing@latest`

Resolution should produce an auditable snapshot/version identifier.

## 4 · Authentication and Authorization

### Human access

Use GitHub OAuth for human-facing management/API access unless the plan explicitly changes the identity provider.

### GitHub Actions

Use GitHub OIDC for GitHub Actions authentication where supported.

The API must verify the OIDC token before trusting repository/workflow identity. Authentication establishes identity; authorization determines which project/profile/resources that identity may access.

Do not treat an OIDC identity as inherently authorized.

### Authorization

Enforce least privilege and explicit resource boundaries. A repository authorized for one project/profile must not automatically gain access to another project/profile.

Test both successful and denied access paths.

### Secrets

Never return provider API keys or database credentials in normal profile/config responses.

Do not log:

- OIDC tokens
- OAuth tokens
- model provider keys
- database credentials
- session secrets

Secrets must be handled through an appropriate secret mechanism and exposed only to the smallest component that needs them.

## 5 · Configuration and Agent Resources

The platform may manage resources such as:

- models/providers
- libraries/dependencies
- skills
- Markdown instructions
- E2E/test definitions
- tools and execution settings
- permissions
- other future agent-environment resources

Do not make every resource a giant unstructured JSON blob. Give important resources explicit schemas and relationships.

Markdown is agent-facing content, not a substitute for structured configuration.

When resolving a profile, return a complete, deterministic configuration contract that an execution client can consume without making many follow-up calls unless the plan explicitly requires otherwise.

## 6 · API Rules

- Use versioned API paths such as `/v1/...`.
- Validate all external input at the boundary.
- Use stable machine-readable error shapes.
- Do not make clients scrape human-readable logs for state.
- Keep response schemas deliberate and backwards-compatible within a major API version.
- Document public endpoints with OpenAPI once the API surface is established.
- Do not expose internal database identifiers unless there is a clear API-level reason.

Prefer resource-oriented endpoints. A single profile-resolution endpoint may aggregate the model, libraries, skills, instructions, tests, and other resolved settings needed by an execution client.

## 7 · Error Handling

Errors must:

- identify the failing subsystem safely
- distinguish authentication, authorization, validation, resolution, persistence, and upstream failures
- avoid leaking credentials or implementation secrets
- provide a stable machine-readable code
- provide an actionable human-readable message where appropriate

For agent/CLI-facing failures, prefer structured JSON with a deterministic schema.

Never convert an unexpected infrastructure failure into a false success.

## 8 · Testing Strategy

### Unit tests

Test pure domain logic such as:

- profile resolution
- version selection
- authorization decisions
- input validation
- resource relationship rules
- config merging/resolution

### Integration tests

Test:

- Hono routes against a real test database or appropriately isolated database layer
- migrations
- persistence behavior
- authentication verification
- API response contracts

### End-to-end tests

The highest-value early E2E flow is:

```text
authenticate GitHub Action identity
        ↓
request project/profile
        ↓
resolve versioned configuration
        ↓
receive deterministic snapshot
```

Also verify denial cases and cross-project isolation.

## 9 · Dependencies and Tooling

Use:

- TypeScript
- Bun
- Hono
- Neon PostgreSQL
- Drizzle ORM
- Zod
- Vitest

Do not add a dependency merely for convenience. Prefer the existing stack or a small focused package when it clearly reduces complexity.

## 10 · Documentation Discipline

When behavior changes:

- Amend `docs/plan.md` first if the implementation plan changes.
- Update relevant developer/API documentation after verified implementation.
- Keep examples executable or clearly label pseudocode.
- Never document an unimplemented feature as complete.

## 11 · Scope Control

Do not build before the plan calls for them:

- a frontend/dashboard
- billing
- analytics systems
- microservices
- Kubernetes
- queues/streaming infrastructure without a demonstrated need
- model-routing complexity beyond the current requirements
- speculative plugin ecosystems

First prove the smallest useful API and GitHub Actions flow.

## 12 · Completion Rule

A phase is complete only when:

1. Every task is `[x]`.
2. Every verification item is `[x]`.
3. The implementation matches the phase deliverable.
4. The relevant checks actually ran and passed.
5. `docs/plan.md` reflects the verified state.

When uncertain, leave the checkbox unchecked and report what remains unverified.
