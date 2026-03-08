# Contact Workspace

## Purpose

This document defines the canonical contact page and the behaviors it must support.

The contact workspace is the core surface of Kanbun. It is where the operator understands a relationship and decides what to do next.

## Page goals

A contact page should answer:

- who is this person
- how do I know them or where did they come from
- what has happened recently
- what is due next
- what sequence or follow-up state are they in

## Primary sections

### Header summary

Should include:

- display name
- primary email
- company or role if known
- tags
- relationship status summary

### Activity and relationship timeline

Should include:

- recent outbound sends
- reply signals
- follow-up events
- task events
- notable imports or merges where relevant

### Notes

Should include:

- operator-authored notes
- lightweight editing
- clear separation from provider-sourced metadata

### Identities and sources

Should include:

- email identities
- provider-linked records
- import sources
- last sync indicators where useful

### Sequence state

Should include:

- current enrollments
- paused or active status
- next due step
- stop reason if applicable

### Tasks and follow-ups

Should include:

- open internal tasks
- due dates
- Todoist mirror state where relevant

## Primary actions

The operator should be able to:

- edit the canonical contact
- add or update notes
- tag the contact
- create an ad hoc follow-up
- enroll the contact in a sequence
- pause or remove sequence enrollment
- inspect source data and merge history

## Editing rules

The contact workspace should make clear which fields are:

- Kanbun-owned and editable
- sourced from providers or imports
- derived or normalized

Manual edits should not feel like they are fighting the sync engine.

## Relationship-state cues

The page should surface practical cues such as:

- no follow-up scheduled
- follow-up overdue
- pending send approval
- sequence paused because of reply
- duplicate candidate exists
- integration degraded for a linked source

These cues should be visible without requiring the operator to inspect low-level logs or history tables.

## Empty and edge states

The first phase should handle:

- newly created contact with little data
- contact created only from CSV
- contact with multiple source identities
- contact with no open tasks or sequences
- contact with a blocked or failed outbound action

## Business rules

- the contact page is the primary decision surface for relationship management
- provider details support trust, but should not dominate the page
- Kanbun-authored notes and workflow state are first-class
- recent and next actions matter more than complete historical exhaustiveness in the default view

## First-phase acceptance criteria

This area is successful if the operator can open a contact and quickly decide:

- whether the record looks correct
- whether anything is due
- whether the person is already in a sequence
- what the next reasonable action should be

## Related docs

- [Contact Ingestion and Unification](./contact-ingestion-and-unification.md)
- [Sequences and Outbound Workflow](./sequences-and-outbound-workflow.md)
- [Follow-Ups and Task Management](./follow-ups-and-task-management.md)
