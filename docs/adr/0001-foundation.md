# ADR-0001: Foundation for Kanbun

- Status: Proposed
- Date: 2026-03-08

## Context

Kanbun is intended to be an open-source personal contact manager for a single primary operator, with room to grow into a more collaborative model later if needed.

The product needs to:

- connect to Gmail and Microsoft Outlook accounts
- ingest contacts from provider syncs and CSV uploads
- store contacts in a durable database that acts as the application system of record
- let the operator place contacts into sequences, send outreach, and manage ad hoc follow-ups
- provide an internal workspace for triage, notes, and relationship management
- integrate with Todoist so follow-up work can flow into a trusted personal task system

In parallel, the repository should be designed for high-quality agent-assisted engineering. The repository itself must become the source of truth for architecture, process, and operating constraints.

## Decision

Kanbun will start with:

- a Next.js web application as the primary product surface
- PostgreSQL as the system-of-record database
- provider integrations for Gmail, Microsoft Outlook, and Todoist behind explicit connector boundaries
- database-centric ingestion and workflow orchestration, with external services treated as sync sources and delivery channels rather than sources of truth
- an agent-first repository operating model with versioned architecture docs, ADRs, explicit execution plans, and mechanical guardrails

This ADR sets the initial direction only. It does not finalize auth, ORM choice, background job implementation, or deployment platform.

## Why this direction

### Product fit

Next.js is a pragmatic fit for an application that needs:

- a single integrated surface for inbox-adjacent workflows, contact records, outreach sequences, and admin settings
- server-rendered and API-backed flows for OAuth, webhook handling, sync operations, and task management
- easy composition of authenticated UI, background-triggering endpoints, and documentation-friendly open-source structure

PostgreSQL is the right foundation because the product requires:

- durable relational storage for contacts, identities, tags, tasks, sequences, and sync state
- strong transactional behavior around imports, deduplication, enrollment changes, and outbound activity
- a stable platform for auditability, search, analytics, and future job orchestration

### Agentic engineering fit

This stack is intentionally conservative. Agent-driven engineering benefits from technologies that are:

- widely documented
- structurally predictable
- easy to test locally
- legible in-repo without hidden platform behavior

A Next.js plus PostgreSQL baseline keeps the system understandable while still supporting the full product surface.

## Architectural shape

Kanbun should be organized around explicit domains and boundaries rather than a flat application.

### Core domains

- Identity and access: user account, provider credentials, session management
- Contacts: canonical contact records, deduplication, source attribution, tags, notes, and relationship metadata
- Communications: outbound messages, message history, provider delivery metadata, and follow-up state
- Sequences: reusable outreach flows, enrollment state, scheduling rules, and pause/exit conditions
- Tasks: internal follow-ups plus Todoist synchronization
- Imports and sync: Gmail sync, Outlook sync, CSV ingestion, reconciliation, and operational logs

### Runtime shape

The product should evolve toward three runtime concerns:

- web application runtime for UI and authenticated actions
- background job runtime for syncs, imports, sequence steps, and retries
- PostgreSQL for canonical data, state transitions, and audit history

The queueing mechanism should likely be Postgres-backed at first to avoid unnecessary moving parts, but the exact implementation is deferred to a follow-up ADR.

## System-of-record model

The application database should be authoritative for Kanbun concepts.

That means:

- external providers remain authoritative only for their own remote resources
- Kanbun owns the canonical merged contact model
- imports and provider syncs create traceable source records and reconciliation metadata
- outbound workflow state lives in Kanbun even when message delivery happens through Gmail or Microsoft APIs

This avoids building the product around fragile pass-through assumptions and makes CSV import, deduplication, notes, and follow-up logic first-class.

## Integration principles

### Gmail and Outlook

- Integrate through official provider APIs, not screen scraping or generic IMAP/SMTP-first assumptions.
- Treat provider connectors as boundary modules with typed inputs and outputs.
- Store sync cursors, webhook metadata, and provider object references explicitly.
- Use connected accounts for sending where possible so the operator works from trusted identities.

### CSV imports

- CSV uploads should create an import artifact, a parsing result, and a normalized write path into contacts.
- Import operations must be traceable and reversible enough to diagnose bad mappings.
- Deduplication rules should be explicit and versionable rather than hidden in one-off scripts.

### Sequences and ad hoc follow-ups

- Sequences should be modeled as durable workflow state, not ephemeral cron logic.
- Ad hoc follow-ups should share primitives with sequences where possible, while remaining faster to create and modify.
- Scheduling, pause rules, completion, and manual overrides must be auditable.

### Todoist

- Todoist integration should be additive, not the primary source of truth for Kanbun tasks.
- Kanbun should own internal task semantics and sync selected tasks to Todoist.
- Todoist failures must not corrupt Kanbun task state.

## Non-goals for the first phase

- building a full multi-tenant CRM
- supporting teams, shared inboxes, or complex role-based permissions
- bulk email marketing infrastructure
- a plugin ecosystem
- broad provider coverage beyond Gmail, Outlook, CSV, and Todoist

## Repository operating model

Kanbun should adopt an agent-first documentation and workflow model from the beginning.

### Repository knowledge structure

The repository should treat docs as the system of record, with a small `AGENTS.md` that points into:

- `docs/adr/` for durable decisions
- `docs/plans/` for active and completed execution plans
- `docs/product/` for product specs and user workflows
- `docs/references/` for provider-specific notes and operational constraints

### Guardrail philosophy

We should encode invariants mechanically where possible instead of relying on taste alone. Early candidates:

- schema validation at external boundaries
- documented dependency and layering rules
- formatting and linting with deterministic local commands
- docs-link and ADR freshness checks
- tests for provider adapters and import normalization rules

### GitHub automation direction

We should follow a lightweight but intentional GitHub setup inspired by the Codex repository:

- issue templates that separate bug reports, feature requests, and docs problems
- a pull request template that asks for rationale and linked context
- dependabot for GitHub Actions and package ecosystem updates
- CI that validates formatting, linting, tests, and documentation structure
- optional Codex-powered issue labeling or deduplication once the repo has enough issue volume to justify it

### Agent workflow direction

The desired operating model is:

- humans define product intent, constraints, and acceptance criteria
- agents implement within documented boundaries
- review feedback gets promoted into docs, lint rules, tests, or templates whenever possible
- small PRs and explicit plans are favored over large implicit rewrites

## Consequences

### Positive

- Clear architectural baseline before code appears
- Strong fit for an open-source project that needs legibility and contributor friendliness
- Lower complexity than a distributed multi-service start
- Better support for long-lived sync state, contact reconciliation, and workflow history
- Better alignment with agent-assisted development practices

### Costs and risks

- OAuth, provider scopes, token refresh, and webhook handling will be a real part of the core architecture early
- Sequence sending introduces deliverability and anti-spam considerations even for a personal tool
- Contact deduplication and merged-record correctness will be one of the hardest product problems
- Open source means secrets handling, local development ergonomics, and provider mocking must be designed carefully
- Next.js alone is not enough; background jobs and operational tooling must be first-class from the start

## Follow-up ADRs

The next decisions should be captured explicitly rather than implied during implementation:

- auth model and secret management
- ORM, migrations, and local database workflow
- background job framework and retry model
- provider sync strategy for Gmail and Microsoft Graph
- contact deduplication and merged-record policy
- outbound message composition and template system
- task sync contract with Todoist
- repository CI, docs linting, and agent workflow automation
- deployment topology and environment strategy
- observability and audit logging

## References

- OpenAI, "Harness engineering: leveraging Codex in an agent-first world" (2026-02-11): https://openai.com/index/harness-engineering/
- Local reference: `/Users/sid/projects/codex/AGENTS.md`
- Local reference: `/Users/sid/projects/codex/.github/workflows/issue-labeler.yml`
- Local reference: `/Users/sid/projects/codex/.github/workflows/issue-deduplicator.yml`
- Local reference: `/Users/sid/projects/codex/.github/dependabot.yaml`
