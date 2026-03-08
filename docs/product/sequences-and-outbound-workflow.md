# Sequences and Outbound Workflow

## Purpose

This document defines the operator-facing workflow for reusable outreach sequences and outbound message execution.

## Product goals

The operator should be able to:

- create reusable personal outreach sequences
- enroll one or many contacts
- see what is due next
- review and approve messages before send
- trust that replies and errors will affect sequence state correctly

## Sequence list view

The `Sequences` area should show:

- sequence name
- status
- number of active enrollments
- due items
- paused or blocked items

## Sequence editor

The first phase should support a simple linear sequence model.

Each sequence should define:

- name
- optional description
- ordered steps
- timing between steps
- default sending identity rules or account choice where relevant
- send mode

## Step model

The first phase should support step types such as:

- outbound email
- task reminder or internal follow-up marker

It is acceptable to begin with email-first steps if the data model still leaves room for internal task steps later.

## Enrollment flow

The operator should be able to enroll contacts from:

- the contact page
- the contacts list
- the sequence page

The enrollment flow should make visible:

- chosen sequence
- chosen sending identity if needed
- next due timing
- known blockers

## Due work and approvals

The system should maintain a queue for due outbound items.

For the first phase, the operator should be able to:

- review the rendered content
- edit the final message
- approve and send
- skip, pause, or stop the next action

## Reply-aware behavior

When the system detects a meaningful reply signal, it should:

- stop or pause automated follow-up by default
- record the reason
- show the state clearly in both the sequence view and contact workspace

## Failure and blocked states

The operator should be able to see:

- send failures
- missing integration permissions
- disconnected sending identities
- paused enrollments
- overdue approvals

## Business rules

- sequence automation should support the operator, not replace judgment
- manual-review send mode is the default first-phase behavior
- sequence state must be durable and inspectable
- no sequence should continue silently after a reply stop-rule is triggered

## First-phase acceptance criteria

This area is successful if the operator can:

- build a basic sequence
- enroll a contact
- review and send a due message
- see reply-based stopping behavior
- recover from blocked or failed states without confusion

## Related docs

- [Contact Workspace](./contact-workspace.md)
- [Follow-Ups and Task Management](./follow-ups-and-task-management.md)
