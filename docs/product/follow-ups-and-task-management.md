# Follow-Ups and Task Management

## Purpose

This document defines ad hoc follow-ups, internal task behavior, and the operator-facing contract for Todoist mirroring.

## Product goals

The operator should be able to:

- create one-off follow-ups quickly
- see all due work in one place
- distinguish between outreach work and general reminders
- mirror selected tasks into Todoist without losing Kanbun context

## Internal task model

Kanbun tasks should be first-class workflow objects.

They may originate from:

- manual follow-up creation
- sequence steps
- import review requirements
- integration issues needing operator intervention

## Task list view

The `Tasks` area should show:

- title
- linked contact if any
- due date
- status
- source or task type
- Todoist mirror status where relevant

## Ad hoc follow-up flow

The first phase should support a fast path to:

1. choose a contact
2. define the follow-up type
3. set due date or timing
4. optionally create a draft outbound item or internal reminder
5. optionally mirror to Todoist

## Task detail behavior

For each task, the operator should be able to:

- mark complete
- snooze or reschedule
- open the linked contact
- inspect source context
- see Todoist sync status if mirrored

## Todoist mirroring behavior

When a task is mirrored, the operator should understand:

- whether the mirror exists
- whether it is healthy
- whether completion has reconciled cleanly

Kanbun should remain the authoritative workflow model even when Todoist is connected.

## Suggested task categories

The first phase should make it easy to distinguish:

- outreach follow-up
- review or admin action
- sequence-generated reminder
- integration-related remediation task

## Home surface integration

Due tasks and follow-ups should also appear on the `Home` surface so the operator does not need to visit multiple screens to know what matters now.

## Business rules

- Kanbun-owned task semantics take precedence over Todoist semantics
- tasks should always preserve their contact and workflow context
- completion in Todoist should reconcile where possible, but not at the cost of Kanbun correctness
- ad hoc follow-ups should feel faster than sequence enrollment

## First-phase acceptance criteria

This area is successful if the operator can:

- create a one-off follow-up in seconds
- see due tasks in one reliable queue
- complete or reschedule tasks cleanly
- mirror selected tasks to Todoist and understand mirror health

## Related docs

- [Contact Workspace](./contact-workspace.md)
- [Sequences and Outbound Workflow](./sequences-and-outbound-workflow.md)
