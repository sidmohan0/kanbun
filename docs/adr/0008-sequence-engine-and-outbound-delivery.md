# ADR-0008: Sequence Engine and Outbound Delivery

- Status: Proposed
- Date: 2026-03-08

## Context

Kanbun needs to support:

- multi-step outreach sequences
- ad hoc follow-ups
- reply-aware workflow management
- personal-email sending through connected accounts

This must not drift into generic bulk email marketing behavior. The product is a personal relationship manager, not a newsletter or campaign system.

## Decision

Kanbun will model outreach as:

- durable sequences with explicit steps
- per-contact sequence enrollment records
- a shared scheduling and delivery pipeline used by both sequence steps and ad hoc follow-ups
- personal one-to-one outbound delivery through connected Gmail or Microsoft accounts
- supervised automation by default, with manual-review as the initial default send mode

Kanbun may later support per-sequence auto-send, but manual-review should be the initial default and safety baseline.

## Why this direction

### Durable workflow state is essential

Sequence execution must survive:

- app restarts
- worker restarts
- reconnect flows
- delayed retries

That requires explicit enrollment and step state in the database.

### Personal outreach needs stricter boundaries than marketing automation

The product should optimize for:

- lower-volume, higher-context outreach
- reply awareness
- operator control
- auditability

It should explicitly avoid becoming a blast engine.

## Sequence model

### Sequence structure

Each sequence should contain:

- metadata and status
- ordered steps
- scheduling offsets or timing rules
- send-mode configuration
- stop rules

The first phase should prefer a linear sequence model over branching workflow complexity.

### Enrollment structure

Each enrollment should track:

- contact
- selected sending identity
- current step
- next due action
- paused/completed/stopped state
- reply or manual-stop signals

## Shared delivery pipeline

Ad hoc follow-ups and sequence steps should converge into one outbound pipeline so the system does not invent two separate models for drafting, approval, sending, and error handling.

Shared stages should include:

- intent creation
- scheduling
- approval state when required
- send execution
- provider confirmation
- post-send state update

## Send modes

### Initial default

The initial default should be manual-review.

That means:

- the system schedules a due outbound item
- the operator approves and sends from within Kanbun
- the delivery pipeline records the send and provider refs

### Later expansion

Per-sequence or per-account auto-send can be added later once:

- rate limiting is in place
- send windows are defined
- provider error handling is mature
- audit visibility is robust

## Reply and stop rules

The engine should stop or pause follow-up automation when meaningful reply signals are detected.

Rules should include:

- stop on reply by default
- allow manual resume or override
- record stop reasons explicitly

## Safety and rate limiting

The delivery pipeline should enforce:

- send windows
- per-account daily caps
- protection against duplicate sends
- clear operator visibility into pending, sent, failed, and blocked items

## Consequences

### Positive

- safer first-phase outbound behavior
- shared primitives for sequence and ad hoc workflows
- clear operational model for approval and delivery
- better alignment with a personal contact manager

### Costs and risks

- manual-review default adds UX work
- sequence state modeling is non-trivial
- auto-send remains a later decision, not an immediate feature

## Follow-up implementation work

- define sequence, step, enrollment, and event schemas
- define approval queue UX requirements
- define stop-on-reply signal rules
- define send caps and send windows

## Related ADRs

- [ADR-0004: Background Jobs, Scheduling, and Retries](./0004-background-jobs-scheduling-and-retries.md)
- [ADR-0005: Gmail Integration Architecture](./0005-gmail-integration-architecture.md)
- [ADR-0006: Microsoft Graph Integration Architecture](./0006-microsoft-graph-integration-architecture.md)
- [ADR-0013: Message Composition and Template System](./0013-message-composition-and-template-system.md)
