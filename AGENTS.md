# Agent Defaults — Agent Instructions

## 0 · Golden Rules (read this first)

1. **Plan-as-code:** `docs/plan.md` is the single source of truth. Code follows the plan — the plan never silently follows code.
2. **Living document, not carved in stone:** the plan *can* change. But change happens only by editing `docs/plan.md` first, deliberately, before touching code. Nothing else (chat, TODOs, issue threads, agent memory) can authorize a deviation.
3. **Plan-first integration:** every new feature or integration starts as an amendment to `docs/plan.md` (goal → tasks → deliverable → verification criteria), then executes through the normal phase loop.
4. **Checkboxes are earned, not assumed:** `[x]` means "verification actually ran and passed." Never mark progress from reasoning alone.
5. **Ship the smallest viable change:** one phase at a time, with typecheck + tests green (the **gates**) before every commit.

## 1 · How We Work: Structured Vibe Coding

- `docs/plan.md` — *what* to build, in what order, and what counts as proof it works.

## 2 · Source-of-Truth Protocol (`docs/plan.md`)

Before writing any code:

1. Read `docs/plan.md`.
2. Identify the current incomplete phase (first phase with unchecked tasks).
3. Read that phase's goal, tasks, deliverable, and verification criteria.
4. Work only within that phase.

### Amending the plan (allowed — but plan-first)

`docs/plan.md` is our default roadmap: mutable, but only through the front door.

Amend the plan **before implementing** when:

- the architecture materially changes
- a phase needs splitting or reordering
- an important requirement is discovered
- a verification requirement changes
- a planned technology is replaced

Rules for amendments:

- A new integration becomes a new phase (or explicit tasks in an existing phase) written into the plan first.
- Write each amendment so a fresh agent can continue from the plan alone, with zero reliance on chat.
- Keep amendments atomic — do not bundle unrelated direction changes into one edit.

## 3 · The Coding Workflow

For every phase, follow this loop:

```text
Code
  ↓
Review with coding sub-agents
  ↓
Test the feature with a testing/E2E agent
  ↓
Commit + push
  ↓
Create PR
  ↓
Wait ~10 minutes
  ↓
Check GitHub AI/bot reviews
  ↓
Fix valid issues
  ↓
Test the feature again
  ↓
Commit + push
  ↓
Wait ~10 minutes
  ↓
Check GitHub AI/bot reviews again
  ↓
Repeat until there are no actionable issues
```

- Build the current phase first. Do not implement speculative later-phase work.
- Use coding-review sub-agents to review the implementation before committing.
- Launch a testing/E2E agent to verify that the feature actually works in the required environment.
- Only commit and push after the implementation has been reviewed and verified.
- Create the PR after pushing the verified work.
- Wait approximately 10 minutes for GitHub AI/code-review bots to review the PR.
- Read every bot suggestion and fix valid improvements or issues.
- After **every** review-driven change, run the relevant feature/E2E tests again to ensure the fix did not break anything.
- Commit and push the verified fixes, then wait for another review cycle.
- Keep looping until the GitHub bots have no actionable issues.

## 4 · Verification Standards (evidence over optimism)

Minimum bar before declaring a phase complete:

- Type checker passes.
- Linter/formatter checks pass.
- Relevant automated tests pass.
- Phase-specific verification steps from `docs/plan.md` have been executed.
- API changes: a real HTTP request/response path is tested where applicable.
- Authentication changes: both an authorized and an unauthorized path are tested.
- Authorization changes: both an allowed and a denied path are tested.

**Blocked-verification rule:** if something cannot run due to environmental limits, do not silently mark it complete. Record the limitation, leave the checkbox unchecked, and report exactly what remains unverified.

## 5 · Git Workflow

- Make coherent commits tied to a phase or tightly related work.
- Run the required review and verification workflow before committing.
- Push the commit to GitHub and create a PR.
- Keep the PR updated through the review/fix/test loop in §3.
- Merge only after the review loop is clean and the phase is verified.

Commit format:

```text
phase N: <short description>
```

Documentation-only progress updates may use:

```text
docs: update phase N progress
```

Never commit secrets, tokens, private keys, or local environment files.

## 6 · Architecture Rules

### Generic core, pluggable consumers

The core API and domain must not depend on a specific AI agent, model provider, GitHub Action implementation, CLI, or SDK:

```text
CLI / GitHub Action / SDK / Agent
              ↓
          Hono API
              ↓
       Domain / Services
              ↓
       PostgreSQL / Neon
```

Clients consume the API contract; they must not depend on internal database details.

### API-first

The API is the primary product surface. Do not introduce a frontend as a core dependency.

### Versioned configuration

Profiles and other centrally managed configuration must be resolvable in a deterministic, version-aware way. A running client must not silently change configuration because the current profile was edited during execution.

## 7 · Security Rules (secrets hygiene)

Security is part of correctness.

- Never put long-lived credentials in public URLs.
- Never log raw access tokens, refresh tokens, OIDC tokens, or client secrets.
- Least privilege: scope credentials to the smallest possible resource.
- Prefer short-lived credentials where supported.
- Validate project, profile, repository, and other resource identity before granting access.
- Resource isolation: one project or repository must never gain access to another project's protected resources without explicit authorization.
- Reject malformed or unexpected identifiers at API boundaries.
- Keep secrets out of source control and documentation examples.
- Treat all external API input as untrusted input.

## 8 · Error Handling (fail loudly, leak nothing)

Do not hide infrastructure failures. Errors must:

- identify the failing subsystem
- contain a safe human-readable explanation
- avoid leaking credentials or internal secrets
- distinguish authentication, authorization, validation, persistence, resolution, and upstream-service failures

API surfaces are consumed by humans *and* AI agents, so additionally:

- API errors must use a stable machine-readable schema.
- Error responses should contain an actionable explanation when possible.
- Agents must never need to scrape free-form logs to determine API state.

For the API, errors should be concise enough to be useful while carrying enough context to diagnose the failure without exposing secrets.

## 9 · Testing Strategy (test pyramid)

**Unit tests** — configuration resolution, authentication logic, authorization decisions, validation, resource relationships, version selection, and helper utilities.

**Integration tests** — API routes, database interactions, migrations, authentication verification, profile resolution, and persistence behavior.

**End-to-end tests** — the highest-value checks should exercise the real API and the important client flow:

```text
authenticate client
    ↓
request project/profile
    ↓
resolve configuration
    ↓
verify returned configuration
```

For autonomous agent testing, verify the complete execution path defined by the relevant test specification rather than relying only on isolated unit tests.

## 10 · Dependencies and Tooling

Use Bun and TypeScript unless the plan explicitly says otherwise.

Do not add a dependency merely because it is convenient — first consider whether behavior fits the current stack or a small focused package. Keep runtime dependencies separate from dev/test dependencies where the package manager supports it.

## 11 · Documentation Discipline

When behavior changes:

- Update `docs/plan.md` if the implementation plan changed.
- Update relevant user/developer/API documentation.
- Keep examples executable or clearly label them as pseudocode.
- Never let documentation describe an unimplemented feature as completed.

## 12 · Scope Control (YAGNI — you aren't gonna need it yet)

Do not build these before the plan reaches the relevant phase:

- a frontend/dashboard
- billing
- analytics dashboards
- complex distributed infrastructure
- Kubernetes orchestration
- queues or streaming infrastructure without a demonstrated need
- speculative model-routing or provider abstractions
- a large plugin ecosystem before the core API is proven

First prove the smallest API and client flow that works reliably.

## 13 · Completion Rule

Say a phase is complete only when **all** of these hold:

1. Every task in the phase is `[x]`.
2. Every verification item in the phase is `[x]`.
3. The implementation matches the phase deliverable.
4. The relevant tests/checks actually ran and passed.
5. `docs/plan.md` reflects the verified state.

When uncertain: **leave the checkbox unchecked** and report what remains unverified. An honest "not yet verified" beats an optimistic "done."
