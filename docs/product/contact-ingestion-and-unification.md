# Contact Ingestion and Unification

## Purpose

This document defines how contacts enter Kanbun and how the product should present ingestion and unification behavior to the operator.

## Sources of contact data

Kanbun should support four input paths in the first phase:

- Gmail-connected account sync
- Outlook-connected account sync
- CSV upload
- manual contact creation

All four paths should ultimately create or update canonical contacts in Kanbun.

## Product goals

The operator should be able to:

- bring contacts into the system without losing source context
- understand what was imported or synced
- trust that Kanbun is not silently corrupting or over-merging records
- resolve ambiguous cases with minimal friction

## Imports surface

The `Imports` area should show:

- import runs
- source type
- created time
- status
- row counts or item counts
- errors and warnings
- links to review details

## CSV upload workflow

### Happy path

The CSV flow should be:

1. upload file
2. inspect column mapping
3. confirm import
4. process rows
5. review summary

### Required behavior

The system should:

- retain an import artifact or import metadata record
- show which fields were mapped
- count created, updated, skipped, and errored rows
- surface merge or validation warnings

### Common CSV fields

The first phase should support practical mappings for:

- first name
- last name
- full name
- email
- phone
- company
- title
- notes
- tags

## Provider sync workflow

### Gmail and Outlook sync

For connected accounts, the product should show:

- last successful sync
- current health state
- last error if any
- approximate objects processed

The operator should not need to guess whether a connected account is working.

### Sync controls

The first phase should support:

- initial sync after connect
- manual re-sync
- visible degraded or reconnect-required state

## Unification behavior

### Canonical result

After ingestion, the operator should interact with:

- canonical contacts
- not raw provider records or raw CSV rows

### Source visibility

The product should preserve and expose:

- where data came from
- when it was last updated
- what source identities are attached

### Ambiguous records

When Kanbun is not confident enough to merge automatically, the system should:

- keep records separate
- flag a review candidate
- avoid silent irreversible behavior

## Status model

Import and sync runs should at minimum support statuses such as:

- queued
- running
- completed
- completed_with_warnings
- failed
- needs_review

The exact storage model can vary, but the operator-facing semantics should remain stable.

## Operator review flows

The first phase should support review for:

- unmapped or invalid CSV values
- duplicate candidates
- records that could not be normalized
- provider reconnect requirements

## Business rules

- imports must be traceable to their source
- source data must not overwrite Kanbun-owned notes silently
- false-positive merges are worse than visible duplicates
- the operator should always be able to understand what changed after an import or sync

## First-phase acceptance criteria

This area is successful if the operator can:

- upload a CSV and understand exactly what happened
- connect Gmail or Outlook and see sync health
- trust the resulting canonical contacts
- identify and resolve questionable merges

## Related docs

- [Contact Workspace](./contact-workspace.md)
- [Operator Model and Information Architecture](./operator-model-and-information-architecture.md)
