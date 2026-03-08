# ADR-0013: Message Composition and Template System

- Status: Proposed
- Date: 2026-03-08

## Context

Kanbun needs outbound communication that supports:

- reusable sequence content
- ad hoc follow-ups
- per-contact personalization
- preview and approval before send

The product is a personal relationship manager, not a mass-marketing platform. That means the composition system should prioritize clarity, reviewability, and safe personalization over rich campaign-builder complexity.

## Decision

Kanbun will use:

- a text-first template system for sequence and ad hoc outbound messages
- explicit variables drawn from Kanbun-owned contact and sequence context
- stored rendered snapshots for sent or approved messages
- manual per-message editing before send
- strict validation around missing variables and rendered output

The first phase will avoid a full visual email-builder or marketing-style HTML template system.

## Why this direction

### Text-first fits the product

Personal outreach usually benefits more from:

- clear writing
- lightweight personalization
- fast review
- easy editing

than from heavy visual templates.

### Rendered snapshots are operationally important

When a message is approved or sent, Kanbun should preserve exactly what was rendered so later edits to templates do not rewrite history.

## Template model

### Authoring

Templates should support:

- subject template
- body template
- optional internal notes or operator guidance
- versioning or immutable revision references once used in delivery records

### Variables

Variables should be explicit and typed where possible.

Examples:

- contact first name
- full name
- company or organization field if present
- sequence metadata
- operator-defined custom fields later

The system should reject or visibly flag templates that reference unknown variables.

## Rendering rules

Rendering should happen inside Kanbun using current application state.

Rules:

- render from internal canonical contact data and allowed source-derived fields
- validate missing required values before approval or send
- preserve rendered snapshot at approval or send time
- record which template version produced the snapshot

## Editing model

The operator should be able to:

- preview the rendered message
- edit the final outgoing content
- approve and send the edited version without mutating the base template unintentionally

This implies a separation between:

- template definition
- rendered candidate
- final outbound snapshot

## Formatting scope

The first phase should prefer:

- plain text
- simple line-break-preserving formatting

HTML support can be introduced later if there is a concrete use case, but it should not complicate the initial send model.

## Safety and quality rules

The composition system should enforce:

- no send when required variables are unresolved
- visible preview before manual-review sends
- protection against empty or obviously malformed outputs
- explicit attribution of template vs final edited content

## Consequences

### Positive

- lower complexity than a rich email-builder
- better fit for personal outreach
- clearer audit trail for what was actually sent
- simpler testing and review

### Costs and risks

- plain-text-first may feel less flexible to some users
- template revision and snapshot logic still require care
- richer formatting becomes a later project rather than a day-one feature

## Follow-up implementation work

- define template and template-revision schema
- define allowed variable catalog
- define render-time validation rules
- define snapshot storage for approvals and sends

## Related ADRs

- [ADR-0008: Sequence Engine and Outbound Delivery](./0008-sequence-engine-and-outbound-delivery.md)
- [ADR-0012: Observability, Audit Logging, and Operational Telemetry](./0012-observability-audit-logging-and-operational-telemetry.md)
