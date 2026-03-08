# ADR-0010: Repository Workflow, CI, and Agent Harness

- Status: Proposed
- Date: 2026-03-08

## Context

Kanbun is being designed for agent-assisted engineering from the start. That requires more than good prompts. It requires repository structure and automation that make the right path obvious and the risky path harder.

The project should borrow selectively from mature agent-friendly repositories without copying unnecessary complexity.

## Decision

Kanbun will adopt the following repository operating model:

- repository-local docs are the source of truth
- `AGENTS.md` remains short and points to deeper docs
- ADRs capture durable technical decisions
- GitHub templates and CI enforce structure around changes
- deterministic local commands are preferred over custom tribal workflows
- repository-specific skills may be added under `.codex/skills/` as workflows become repeatable

The repository will start simple, but the harness model is part of the architecture, not an afterthought.

## Why this direction

### Agent quality is mostly a repo design problem

Agents perform better when the repository provides:

- clear entry points
- explicit boundaries
- deterministic commands
- minimal hidden state
- docs that are close to the code

This is the most important takeaway to encode from harness-oriented engineering.

## Repository structure

The repo should maintain:

- `AGENTS.md` as the map
- `docs/adr/` for architecture
- `docs/plans/` for scoped execution plans
- `docs/product/` for product behavior and user flows
- `docs/references/` for provider and operational notes
- `.github/` for templates and workflows
- `.codex/skills/` for reusable repo-specific agent workflows when justified

## CI principles

The initial CI baseline should validate:

- formatting
- linting
- typechecking
- tests
- migration integrity
- docs link and structure checks

CI should start narrow and deterministic rather than broad and flaky.

## GitHub hygiene

The repository should add:

- issue templates for bugs, features, and docs
- a pull request template that asks for rationale and linked context
- Dependabot for GitHub Actions and package dependencies
- path-aware workflows where useful

Codex-powered issue labeling or deduplication can be added later if project volume justifies it, but it should not be part of the first bootstrap.

## Command design

The project should expose a small set of stable commands for humans and agents.

Likely examples:

- install dependencies
- start local infrastructure
- run app
- run worker
- apply migrations
- run tests
- lint and format

These commands should be documented once and reused consistently in CI and local development.

## Change management rules

The repository should normalize the following behavior:

- important architecture changes require ADR updates
- new subsystems arrive with docs, not only code
- provider behavior changes require reference-doc updates
- small, scoped pull requests are preferred

## Consequences

### Positive

- stronger contributor onboarding
- better agent reliability
- lower risk of design context living only in chat history
- cleaner path from planning to implementation

### Costs and risks

- documentation discipline requires maintenance
- some upfront process work arrives before feature work
- there is a temptation to over-automate before the repo stabilizes

## Follow-up implementation work

- define the initial command surface
- add GitHub templates
- add baseline CI workflows
- add `.codex/skills/` only for stable, repeated repo workflows

## Related ADRs

- [ADR-0001: Foundation for Kanbun](./0001-foundation.md)
