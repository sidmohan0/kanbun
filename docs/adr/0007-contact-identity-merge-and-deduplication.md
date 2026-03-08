# ADR-0007: Contact Identity, Merge, and Deduplication

- Status: Proposed
- Date: 2026-03-08

## Context

Contact correctness is one of the hardest parts of the product.

Kanbun will ingest contact-like data from:

- Gmail-related sources
- Microsoft-related sources
- CSV imports
- manual edits

The same person may appear many times with different names, partial records, or conflicting metadata. The application needs a model that supports source fidelity without fragmenting the operator’s working view.

## Decision

Kanbun will use:

- a canonical `contact` record as the primary working object
- separate `contact_identity` and `contact_source` records to preserve source-specific facts
- conservative automatic merges only for high-confidence matches
- explicit merge provenance and reversible merge history where practical
- manual review for ambiguous duplicates

Kanbun will not treat imported rows or provider objects as the canonical contact record directly.

## Why this direction

### Canonical working view plus preserved sources

The operator needs one place to manage:

- notes
- sequences
- tasks
- relationship state

At the same time, source fidelity matters for debugging and trust. The system must preserve where data came from and how it was merged.

### Conservative merges are safer than clever merges

A personal contact manager can recover from seeing duplicate contacts more easily than from silently merging two different people. The system should optimize for avoiding false positives.

## Data model

### Canonical contact

The canonical contact is the working object used by the application.

It should own:

- display name
- primary status fields
- notes and tags
- relationship metadata
- sequence enrollment and task linkage

### Contact identities

Identities represent ways to reach or recognize a person.

Examples:

- email address
- provider contact id
- provider person id

Identity records should be normalized, typed, and attributable to a source.

### Contact sources

Source records preserve where facts came from.

Examples:

- Google People entry
- Microsoft contact entry
- CSV import row
- manual entry

## Merge rules

### High-confidence automatic merge

Automatic merge is acceptable when:

- the same normalized email address is already attached to a contact and the new record is not contradictory
- the provider object being ingested is already linked through an existing source reference
- another explicitly versioned strong-match rule is defined and tested

### Ambiguous match handling

Ambiguous candidates should not auto-merge.

Instead, Kanbun should:

- record the candidate relationship
- surface a manual review path
- keep the source data available for inspection

### Merge provenance

When a merge occurs, the system should preserve:

- which records were merged
- why the merge happened
- what identities and sources moved
- when the merge occurred

## Field-level reconciliation

Not all fields should reconcile the same way.

Examples:

- identities should generally accumulate unless invalidated
- names may need precedence rules and operator override
- notes should remain Kanbun-authored and not be overwritten by providers
- provider-originated metadata should remain attributable to its provider

The canonical record should be operator-friendly, but never lose traceability.

## Manual contact editing

Manual edits should be first-class and should generally take precedence for Kanbun-owned presentation fields unless the operator explicitly resets them.

Provider sync should enrich and update sourced data without clobbering operator intent.

## Consequences

### Positive

- safer deduplication behavior
- cleaner operator experience around one working contact object
- preserved source traceability
- better debugging when imports or syncs behave unexpectedly

### Costs and risks

- contact modeling becomes more sophisticated
- merge and unmerge logic require careful implementation
- manual-review tooling is required for ambiguous cases

## Follow-up implementation work

- define canonical contact and identity schemas
- define normalization rules for email and provider refs
- define candidate-merge generation rules
- define merge history and operator review UX requirements

## Related ADRs

- [ADR-0001: Foundation for Kanbun](./0001-foundation.md)
- [ADR-0003: Database, ORM, Migrations, and Local Development](./0003-database-orm-migrations-and-local-dev.md)
- [ADR-0005: Gmail Integration Architecture](./0005-gmail-integration-architecture.md)
- [ADR-0006: Microsoft Graph Integration Architecture](./0006-microsoft-graph-integration-architecture.md)
