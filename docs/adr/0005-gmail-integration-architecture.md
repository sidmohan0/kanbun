# ADR-0005: Gmail Integration Architecture

- Status: Proposed
- Date: 2026-03-08

## Context

Kanbun must integrate with Gmail-connected accounts for:

- contact and communication context
- outbound email delivery
- inbox-adjacent follow-up workflows

Google exposes these capabilities across different APIs and permission sets. The integration needs to be useful, operationally realistic, and not overly complex for the first release.

## Decision

Kanbun will use:

- Google OAuth for connected-account authorization
- Gmail API for mail send and message metadata workflows
- Google People API for contact-related synchronization
- polling-first incremental sync for the first phase
- provider-specific connector modules that normalize Google data into Kanbun-owned models

Kanbun will not depend on direct IMAP/SMTP integration as the primary Google path.

## Why this direction

### Official APIs are the correct boundary

Official Google APIs provide:

- clear OAuth semantics
- explicit scopes
- stable identifiers
- provider-supported send behavior

This is safer and more maintainable than building around lower-level protocols first.

### Polling-first reduces first-phase operational burden

Gmail push mechanisms can be useful later, but they add setup and operational overhead. For a personal tool and first release, polling-first is the right tradeoff.

The initial system should prioritize:

- correct sync state
- clear cursors and replay behavior
- robust reconnect flows

## Integration scope

### Google services used

- Gmail API for send, thread/message metadata, and selected mailbox state
- Google People API for contacts and contact metadata

### Initial sync priorities

Kanbun should initially sync:

- primary contact identifiers
- names and contact profile fields available through People API
- mail thread and message metadata needed for relationship state and reply detection

The first phase should prefer metadata and selected structured content over full mailbox mirroring.

## Sync strategy

### Polling-first model

The Gmail connector should run scheduled incremental sync jobs.

Rules:

- store Google sync cursors and history markers explicitly
- treat sync runs as durable operational records
- support replay from a known checkpoint when safe
- degrade to re-auth or limited resync when cursors become invalid

### Data normalization

Provider objects should be converted into:

- contact source records
- contact identities
- provider message references
- communication state updates

Raw provider payload fragments may be retained for debugging where needed, but Kanbun’s domain tables remain the source of truth for application behavior.

## Outbound send model

Kanbun should send through Gmail using the connected account identity.

Rules:

- store outbound attempt records in Kanbun before provider send
- persist provider message and thread references after send
- keep provider error details in structured operational records
- never treat a queued send as completed until Google confirms success

## Scope discipline

Google permissions should be kept as narrow as the product allows.

Requirements:

- document exact scopes in `docs/references/`
- separate read and send requirements conceptually
- surface missing consent clearly in the UI and operational logs

## Failure model

The connector should explicitly handle:

- expired or revoked refresh tokens
- partial sync failures
- rate limits and temporary provider outages
- invalid cursors or out-of-date history checkpoints

When the connector cannot safely continue, the connected account should move to a degraded or reconnect-required state rather than silently failing.

## Consequences

### Positive

- clear provider boundary
- better long-term maintainability than protocol-first integration
- manageable first-phase operational complexity
- good support for send and reply-aware workflows

### Costs and risks

- Google scopes and verification requirements may become a setup burden
- polling is less real-time than push
- People API and Gmail API data will not map perfectly into one canonical contact model without reconciliation work

## Follow-up implementation work

- define exact Google scopes
- define Gmail and People sync cursors
- define send pipeline payloads and provider refs
- document reconnection and revoked-token handling

## Related ADRs

- [ADR-0002: Auth, Connected Accounts, and Secret Management](./0002-auth-connected-accounts-and-secrets.md)
- [ADR-0004: Background Jobs, Scheduling, and Retries](./0004-background-jobs-scheduling-and-retries.md)
- [ADR-0007: Contact Identity, Merge, and Deduplication](./0007-contact-identity-merge-and-deduplication.md)
