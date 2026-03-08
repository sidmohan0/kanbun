# ADR-0012: Observability, Audit Logging, and Operational Telemetry

- Status: Proposed
- Date: 2026-03-08

## Context

Kanbun will operate against personal communication systems and relationship data. When things go wrong, the operator must be able to answer:

- what happened
- when it happened
- what changed
- whether a provider, worker, or application error caused it

Observability is therefore part of the core architecture, not optional polish.

## Decision

Kanbun will use a layered observability model consisting of:

- structured application logs
- application-level audit events stored in PostgreSQL
- metrics and traces through OpenTelemetry-compatible instrumentation
- explicit redaction rules for secrets and sensitive payloads
- health and readiness endpoints for operational checks

This model applies to both the web and worker runtimes.

## Why this direction

### Logs alone are not enough

Standard logs help with debugging, but they do not replace audit trails for domain actions such as:

- provider reconnection
- contact merges
- sequence enrollment changes
- outbound send approvals
- import completion or failure

### Audit events are a product requirement

Because Kanbun will make or recommend relationship actions, the operator needs durable history of important state changes.

## Observability layers

### Structured logs

All runtime logs should be structured and machine-parseable.

They should include:

- timestamp
- runtime role
- request or job correlation ids
- event name
- severity
- safe contextual metadata

### Audit events

Audit events should be stored for important business actions.

Examples:

- sign-in and sign-out
- provider connected or disconnected
- token refresh failure state transition
- import created, completed, failed
- contact merged or manually edited
- sequence enrollment paused, resumed, completed
- outbound send approved, sent, failed

### Metrics and traces

The system should instrument:

- request latency
- job duration
- job failure counts
- sync success and failure counts
- provider call latency and error rates

OpenTelemetry gives the right neutral standard for this layer.

## Redaction and privacy rules

The system must not leak secrets or more personal content than necessary into telemetry.

Rules:

- never log refresh tokens, session secrets, or raw credentials
- minimize raw message body logging
- store provider payload fragments only when justified for debugging
- define explicit redaction helpers and use them consistently

## Operational surfaces

The application should expose:

- health checks
- readiness checks
- worker-health visibility
- admin-visible sync and queue state where appropriate

The operator should not need to inspect raw infrastructure logs for basic operational understanding.

## Consequences

### Positive

- better debugging and trust
- safer operation around outbound communication
- strong fit for sync and sequence-heavy workflows
- easier future production support

### Costs and risks

- telemetry discipline must be maintained
- audit tables and instrumentation add implementation work
- poorly designed logging could still leak sensitive information if not reviewed carefully

## Follow-up implementation work

- define the audit event catalog
- define correlation-id strategy
- define OTel setup and exporters
- define redaction helpers and logging policy

## Related ADRs

- [ADR-0004: Background Jobs, Scheduling, and Retries](./0004-background-jobs-scheduling-and-retries.md)
- [ADR-0008: Sequence Engine and Outbound Delivery](./0008-sequence-engine-and-outbound-delivery.md)
- [ADR-0011: Deployment Topology and Environment Strategy](./0011-deployment-topology-and-environment-strategy.md)
