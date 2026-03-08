# ADR-0006: Microsoft Graph Integration Architecture

- Status: Proposed
- Date: 2026-03-08

## Context

Kanbun must also support Outlook-connected accounts. For Microsoft ecosystems, the right integration boundary is Microsoft Graph rather than Outlook-specific legacy protocols.

This integration must support:

- contact and mailbox context
- outbound email delivery
- future-proof sync state

## Decision

Kanbun will use:

- Microsoft OAuth with delegated permissions
- Microsoft Graph as the only first-phase Outlook integration boundary
- delta-query or incremental polling patterns where supported
- polling-first synchronization for the first release
- a dedicated Microsoft connector module separate from the Google connector

Kanbun will not depend on Exchange protocol-specific implementations in the first phase.

## Why this direction

### Graph is the stable Microsoft application boundary

Using Microsoft Graph:

- aligns with Microsoft’s modern ecosystem
- gives consistent auth and permission behavior
- reduces future migration risk
- supports both mail and contact-adjacent data needs

### Separate connector modules matter

Google and Microsoft should converge into shared internal models, but they should not share one provider implementation. Their auth models, APIs, delta semantics, and error cases differ too much.

## Integration scope

The Microsoft connector should support:

- contact-related synchronization
- mail metadata and reply-state synchronization
- outbound mail sending through the connected identity

The first phase should remain focused on relationship-management use cases, not full mailbox replication.

## Sync strategy

### Polling-first with incremental sync

The connector should prefer Microsoft Graph incremental mechanisms where available and fall back to scheduled polling where needed.

Rules:

- store delta links or equivalent sync cursors explicitly
- record sync runs durably
- detect invalidated cursors and trigger safe recovery flows
- avoid hidden state that exists only in memory

### Normalization

The connector should normalize Microsoft provider data into Kanbun-owned records for:

- contact sources
- contact identities
- provider communication references
- relationship signals such as recent interaction metadata

## Outbound send model

Outbound mail should be issued through Microsoft Graph using the connected account.

Rules:

- record the Kanbun outbound intent first
- persist provider references after confirmation
- track provider-specific error classes separately from Kanbun business-state failures

## Scope discipline

Microsoft permissions should be the minimum required for current features.

Requirements:

- document all delegated permissions in `docs/references/`
- keep send-related permissions separate from read-related rationale
- expose consent mismatches clearly to the operator

## Failure model

The connector should handle:

- revoked consent
- expired tokens
- throttling
- delta invalidation
- mailbox or tenant policy restrictions

The integration should move into a visible degraded state when safe operation is no longer possible.

## Consequences

### Positive

- modern Microsoft integration boundary
- clear separation from Google implementation
- good support for a unified internal contact and communication model

### Costs and risks

- Microsoft Graph has its own complexity and permission quirks
- tenant policies may vary more than consumer Google setups
- delta and send semantics need careful testing with fixtures

## Follow-up implementation work

- define exact Graph permissions
- define cursor and recovery rules
- define send and sync provider refs
- document tenant-policy edge cases in references

## Related ADRs

- [ADR-0002: Auth, Connected Accounts, and Secret Management](./0002-auth-connected-accounts-and-secrets.md)
- [ADR-0004: Background Jobs, Scheduling, and Retries](./0004-background-jobs-scheduling-and-retries.md)
- [ADR-0007: Contact Identity, Merge, and Deduplication](./0007-contact-identity-merge-and-deduplication.md)
