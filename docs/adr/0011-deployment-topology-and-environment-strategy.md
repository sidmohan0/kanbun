# ADR-0011: Deployment Topology and Environment Strategy

- Status: Proposed
- Date: 2026-03-08

## Context

Kanbun needs a deployment model that supports:

- a Next.js web application
- a separate worker runtime
- PostgreSQL
- secure OAuth callbacks
- self-hostability for open-source users

The deployment model should not lock the project into a platform that is awkward for background jobs or operationally opaque for contributors.

## Decision

Kanbun will target a container-friendly deployment model with:

- a `web` runtime for the Next.js application
- a `worker` runtime for background jobs
- managed or self-hosted PostgreSQL
- environment-based secret injection
- optional object storage only when a concrete feature requires it

The project will avoid designing around serverless-only assumptions in the first phase.

## Why this direction

### Worker requirements matter

The product has first-class background processing requirements. A deployment shape that treats the web app as the whole system would create friction immediately.

### Open source benefits from self-hostable patterns

A container-friendly topology:

- is easier to explain
- is easier to reproduce locally
- is less coupled to a single commercial platform

## Runtime topology

### Minimum production shape

- `web`: serves UI, API routes, OAuth callbacks
- `worker`: runs scheduled and queued background jobs
- `postgres`: primary database

Additional infrastructure should only be introduced when there is a proven need.

### Environment classes

The system should assume at least:

- local development
- preview or staging
- production

Each environment should have clear configuration boundaries and isolated credentials.

## Secrets and configuration

Runtime configuration should be environment-driven.

Rules:

- no production secrets in the repository
- no secret defaults that make accidental insecure deployment easy
- configuration docs should distinguish required, optional, and provider-specific variables

## Storage expectations

The first phase should keep storage simple:

- PostgreSQL for application state
- local disk or optional object storage only for import artifacts if needed

Blob/object storage should not be introduced until the exact file-retention requirement is clear.

## Preview and developer experience

The project should support:

- local Docker Compose
- simple single-branch preview deployment later
- production deployment without architecture changes between environments

This matters for contributors and for agent-generated changes that need predictable verification surfaces.

## Consequences

### Positive

- good fit for Next.js plus worker architecture
- easier self-hosting story
- less platform lock-in
- clearer operational boundaries

### Costs and risks

- more operational surface area than a pure serverless deployment
- preview infrastructure may require extra setup
- containerization quality must be treated as part of the product

## Follow-up implementation work

- define container images and process commands
- define environment variable catalog
- define local compose stack
- define deployment examples for at least one hosted target

## Related ADRs

- [ADR-0003: Database, ORM, Migrations, and Local Development](./0003-database-orm-migrations-and-local-dev.md)
- [ADR-0004: Background Jobs, Scheduling, and Retries](./0004-background-jobs-scheduling-and-retries.md)
