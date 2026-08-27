# Agent Defaults — Agent Instructions

## 0 · Golden Rules

1. **Plan-as-code:** `docs/plan.md` is the single source of truth for what to build and in what order.
2. **Plan first:** material feature, architecture, or technology changes must be added to `docs/plan.md` before implementation.
3. **Evidence over assumption:** `[x]` means the required verification actually ran and passed.
4. **One phase at a time:** implement only the current phase.

## 1 · Source-of-Truth Protocol

Before coding:

1. Read `docs/plan.md`.
2. Find the first phase with unchecked work.
3. Read that phase's goal, tasks, deliverable, and verification.
4. Work only within that phase.

When requirements change, amend `docs/plan.md` first. Keep each amendment atomic and sufficient for a fresh agent to continue without chat history.

## 2 · Coding Workflow

For every phase:

```text
Code
  ↓
Review with coding sub-agents
  ↓
Run the phase verification with a testing/E2E agent
  ↓
Commit + push
  ↓
Create PR
  ↓
Wait ~10 minutes
  ↓
Review GitHub AI/bot feedback
  ↓
Fix valid issues
  ↓
Run the phase verification again
  ↓
Commit + push
  ↓
Repeat review → fix → verification until no actionable bot issues remain
```

The verification procedure and acceptance criteria come from `docs/plan.md`.

## 3 · Git Workflow

- Commit only verified work.
- Push the commit to GitHub.
- Create or update the PR.
- Keep the PR in the review → fix → verification loop until clean.
- Merge only after the phase is verified and the review loop is clean.

Commit format:

```text
phase N: <short description>
```

Documentation-only progress:

```text
docs: update phase N progress
```

Never commit secrets, tokens, private keys, or local environment files.

## 4 · Project Boundaries

- The API is the primary product surface; no frontend is required.
- Keep the core domain independent of a specific AI agent, model provider, GitHub Action, CLI, or SDK.
- Clients use the API contract, not the database schema.
- Profiles and centrally managed configuration are versioned and deterministically resolvable.

## 5 · Security

- Authenticate before protected operations.
- Authorize every project/profile/resource access.
- Use least-privilege access.
- Prefer short-lived credentials.
- Never expose or log tokens, provider keys, database credentials, or other secrets.
- Keep projects and repositories isolated by explicit authorization.

## 6 · API Behavior

- Use versioned API paths such as `/v1/...`.
- Validate external input at the API boundary.
- Return stable machine-readable errors.
- Keep route handlers thin; domain behavior belongs in services/modules.

## 7 · Documentation

When behavior changes:

- Update `docs/plan.md` when the plan changes.
- Update relevant API/developer documentation after verification.
- Do not document unimplemented behavior as complete.

## 8 · Completion Rule

A phase is complete only when:

1. Every task is `[x]`.
2. Every verification item is `[x]`.
3. The deliverable matches the implementation.
4. The required checks actually ran and passed.
5. `docs/plan.md` matches the verified state.

When uncertain, leave the checkbox unchecked and state what remains unverified.
