# ADR-0004: Background Jobs, Scheduling, and Retries

- Status: Proposed
- Date: 2026-03-08

## Context

Kanbun will need asynchronous execution for:

- Gmail and Microsoft sync runs
- CSV parsing and import normalization
- sequence step execution
- ad hoc follow-up scheduling
- token refresh and reconnect checks
- Todoist synchronization

These workflows require retries, visibility, and durable state. They should not run as ad hoc in-process timers inside the web server.

## Decision

Kanbun will use:

- a dedicated worker runtime separate from the web runtime
- a PostgreSQL-backed job queue
- Graphile Worker as the initial job execution system
- database-backed scheduling and retry metadata
- idempotent job handlers with explicit deduplication keys where applicable

This is the default asynchronous execution model for the first phase.

## Why this direction

### Separate web and worker runtimes

The web process should handle:

- UI requests
- API endpoints
- OAuth callbacks
- lightweight orchestration

The worker process should handle:

- sync runs
- imports
- outbound execution
- scheduled state transitions

This separation improves reliability and avoids request-time coupling to slow or retry-prone operations.

### Postgres-backed jobs are enough for the first phase

Kanbun already depends heavily on PostgreSQL. Introducing Redis or a dedicated workflow engine immediately would increase operational complexity before the core product proves itself.

Graphile Worker is a strong fit because it provides:

- durable jobs in PostgreSQL
- retries and backoff
- cron support
- Node compatibility
- a clear operational model

## Job design principles

### Idempotency

Every job handler should be safe to retry.

That means:

- write operations should check current state before acting
- outbound provider actions should use idempotency keys or stored provider refs where possible
- job side effects should be recorded so duplicates can be detected

### Small, typed job payloads

Jobs should reference stable internal ids, not carry large mutable payloads.

Preferred pattern:

- enqueue a small payload with object ids
- load current state from PostgreSQL at execution time
- write explicit state transitions and event records

### Durable scheduling

Sequence timing and sync cadence should be represented by durable database state, not only by worker queue timing.

This ensures:

- recoverability after downtime
- inspectable schedule state
- easier reconciliation and replay

## Retry policy

Retries should be explicit and bounded.

General rules:

- transient provider failures should retry with backoff
- validation failures should not retry blindly
- auth failures should move integrations into a reconnect-required state
- repeated outbound send failures should stop sequence progression for the affected enrollment until reviewed

## Cron and recurring work

Recurring jobs should be limited to orchestration tasks such as:

- schedule due sequence steps
- discover overdue sync runs
- sweep stuck jobs or stale locks
- refresh health summaries

The cron layer should enqueue targeted work rather than performing large business operations directly.

## Operational visibility

The job system should expose:

- job name
- payload ids
- enqueue time
- attempt count
- last error
- final state

Important workflow actions should also emit application-level event records, not only job-run metadata.

## Consequences

### Positive

- durable async processing
- simpler first-phase infrastructure
- good fit for sequence and sync workloads
- clear separation between request handling and background execution

### Costs and risks

- Postgres becomes more operationally important
- worker idempotency requires careful handler design
- long-running jobs must still be split sensibly to avoid lock contention and poor observability

## Follow-up implementation work

- define the worker process entrypoint
- define the first job catalog
- establish retry and dead-letter handling rules
- define lock and deduplication patterns for sync and outbound jobs

## Related ADRs

- [ADR-0003: Database, ORM, Migrations, and Local Development](./0003-database-orm-migrations-and-local-dev.md)
