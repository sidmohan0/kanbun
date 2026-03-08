# ADR-0009: Todoist Sync Contract

- Status: Proposed
- Date: 2026-03-08

## Context

Kanbun needs Todoist integration so relationship-driven tasks can appear inside the operator’s existing personal task workflow. However, Kanbun also needs its own internal task model because tasks are tightly linked to:

- contacts
- sequences
- follow-ups
- operational reminders

If Todoist becomes the primary source of truth, Kanbun loses workflow integrity and context.

## Decision

Kanbun will use:

- an internal Kanbun-owned task model as the source of truth
- optional Todoist mirroring for selected tasks
- one linked Todoist item per mirrored Kanbun task
- bi-directional completion/status reconciliation where feasible
- one-way metadata ownership from Kanbun to Todoist for Kanbun-specific fields

Todoist is a synced task surface, not the canonical workflow engine.

## Why this direction

### Kanbun tasks carry domain meaning

Kanbun tasks are not generic reminders. They are tied to:

- people
- outreach state
- follow-up intent
- provider or sequence state

That domain meaning must stay inside Kanbun.

### Todoist is valuable as an execution surface

Todoist is still useful because it is where the operator may already manage daily execution. Mirroring selected tasks there reduces context switching without giving up Kanbun’s internal workflow model.

## Sync model

### Kanbun-owned fields

Kanbun should own:

- task type
- contact linkage
- sequence linkage
- workflow status semantics
- internal notes and metadata

### Todoist-mirrored fields

Todoist mirror records may include:

- title
- due date
- priority mapping
- project or label mapping if configured
- a backlink to the Kanbun task

### Reconciliation rules

The first phase should support:

- create mirrored Todoist task from Kanbun
- update mirrored task when Kanbun-owned mirrored fields change
- ingest completion or closure changes from Todoist where possible

If conflicting edits occur, Kanbun should preserve internal workflow state and record the conflict rather than losing information.

## Failure model

Todoist sync failures should:

- not delete or corrupt Kanbun tasks
- mark the mirror as degraded or out-of-sync
- remain visible to the operator
- be retryable through background jobs

## Scope discipline

The Todoist integration should request only the permissions needed for task mirroring and reconciliation.

These permissions should be documented in `docs/references/`.

## Consequences

### Positive

- preserves Kanbun as the workflow system of record
- still supports the operator’s existing task habits
- avoids over-coupling Kanbun to an external task product

### Costs and risks

- task reconciliation logic adds complexity
- some Todoist semantics may not map neatly to Kanbun task semantics
- conflict handling needs explicit UX and event logging

## Follow-up implementation work

- define Kanbun task schema
- define Todoist mirror schema
- define field mapping rules
- define completion and conflict behavior

## Related ADRs

- [ADR-0002: Auth, Connected Accounts, and Secret Management](./0002-auth-connected-accounts-and-secrets.md)
- [ADR-0004: Background Jobs, Scheduling, and Retries](./0004-background-jobs-scheduling-and-retries.md)
