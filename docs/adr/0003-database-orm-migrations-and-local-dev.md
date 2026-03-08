# ADR-0003: Database, ORM, Migrations, and Local Development

- Status: Proposed
- Date: 2026-03-08

## Context

Kanbun needs a durable relational core for:

- canonical contacts
- source identities and provider objects
- sequences and sequence enrollment
- tasks and Todoist mirrors
- imports, sync cursors, and job state
- audit records and operational metadata

This project is also being set up for agent-assisted engineering and open-source collaboration. That means the data layer must be:

- explicit
- reviewable
- easy to run locally
- safe to evolve through small migrations

## Decision

Kanbun will use:

- PostgreSQL as the only primary transactional database
- Drizzle ORM for typed application queries and schema definition
- SQL migrations generated and reviewed through Drizzle tooling
- a local developer PostgreSQL instance via Docker Compose
- one canonical application schema in the main database rather than splitting early into multiple databases

The implementation should avoid hidden schema drift, migration side effects, and provider-specific state that is not represented explicitly in the database.

## Why this direction

### PostgreSQL is the right core datastore

The system has strongly relational behavior:

- one contact can have many identities
- one source import can create many records
- one sequence can enroll many contacts
- one connected account can own many provider objects and sync cursors

PostgreSQL gives us:

- transactions
- constraints
- indexing flexibility
- row locking for worker coordination
- good support for auditability and search-oriented extensions later

### Drizzle is a good fit for this repository

The project benefits from an ORM/query layer that stays close to SQL, keeps types legible in TypeScript, and avoids too much hidden runtime machinery.

Drizzle is a good fit because it favors:

- explicit schema definitions
- explicit SQL-like query construction
- straightforward migration artifacts
- low magic relative to heavier ORM systems

## Data modeling principles

The database should reflect domain boundaries directly.

### Core table families

- auth tables: users, sessions, connected accounts
- contact tables: contacts, contact_identities, contact_sources, contact_notes, tags, tag_links
- communication tables: message_threads, messages, outbound_deliveries, provider_message_refs
- sequence tables: sequences, sequence_steps, sequence_enrollments, sequence_events
- task tables: tasks, task_links, todoist_task_refs
- import and sync tables: imports, import_rows, sync_runs, sync_cursors, provider_objects
- audit tables: audit_events and operational event records

### Modeling rules

- keep provider-specific raw ids in dedicated columns
- do not overload one table to represent multiple domains
- keep explicit foreign keys where ownership matters
- use soft deletion only where operationally necessary
- preserve source attribution when imported or synced records are merged

## Primary key and identifier rules

The database should use opaque internal ids for Kanbun-owned objects. External provider ids should never become the primary keys of core domain tables.

This allows:

- safer merges
- provider reconnect flows
- future migration between providers or connectors
- cleaner API boundaries

UUIDs are the leading candidate for core ids, but the deeper id convention can be finalized during implementation as long as internal and external identifiers remain separate.

## Migration strategy

Schema changes must be represented by versioned migrations committed to the repository.

Rules:

- every schema change requires a migration file
- migrations should be human-reviewable
- generated SQL should be reviewed before merge
- destructive changes should be staged over more than one release when possible
- seed data should be separate from schema migrations unless it is essential bootstrap metadata

The project should optimize for forward-only migrations in normal operation.

## Local development workflow

The default local development model should be:

- Docker Compose provides PostgreSQL
- application and worker connect through environment variables
- migrations can be applied with one deterministic command
- test databases are created separately from the development database

This gives contributors and agents a reproducible starting point without requiring a cloud environment.

## Test database expectations

Tests should not share the same database state as local development.

Expected pattern:

- isolated test database or schema
- migration-driven test setup
- fixtures created by code or SQL seeds committed to the repo
- no reliance on manually prepared local state

## Consequences

### Positive

- explicit schema evolution
- strong fit for jobs, sequences, and sync state
- good local reproducibility
- legible SQL-oriented development for humans and agents

### Costs and risks

- migration discipline is required from the beginning
- relational modeling work must be done carefully up front
- Docker-based local setup adds some environment overhead

## Follow-up implementation work

- define the initial schema modules
- choose id conventions precisely
- create migration and reset commands
- create local Docker Compose services
- document backup and restore expectations for development

## Related ADRs

- [ADR-0001: Foundation for Kanbun](./0001-foundation.md)
- [ADR-0002: Auth, Connected Accounts, and Secret Management](./0002-auth-connected-accounts-and-secrets.md)
