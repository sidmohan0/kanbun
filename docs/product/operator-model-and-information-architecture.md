# Operator Model and Information Architecture

## Purpose

This document defines the initial operator, product posture, and top-level application structure for the first implementation phase of Kanbun.

## Primary operator

Kanbun is initially designed for one operator:

- a single person managing personal and professional relationships
- someone who already works across Gmail, Outlook, spreadsheets, and Todoist
- someone who wants one operational system for contacts, follow-ups, and outreach

The product is not initially optimized for:

- shared team workflows
- delegated assistants
- high-volume marketing operations

## Product posture

Kanbun should feel like:

- a relationship operating system
- a clean, high-trust workspace for personal outreach
- a tool that helps the operator decide and act

Kanbun should not feel like:

- a CRM built for sales teams
- a newsletter platform
- an inbox replacement

## Core jobs the product must do

The first implementation phase should help the operator:

- unify contacts from Gmail, Outlook, CSV, and manual edits
- understand who a person is and what the current relationship state looks like
- schedule and execute thoughtful follow-ups
- use reusable sequences without losing human control
- keep actionable work visible inside Kanbun and optionally mirrored to Todoist

## Top-level navigation

The initial product should have six primary surfaces.

### Home

Purpose:

- show what needs attention now
- summarize due follow-ups, pending approvals, failed syncs, and recent imports

### Contacts

Purpose:

- search and browse canonical contacts
- filter by tags, source, sequence status, and follow-up state
- enter the contact workspace

### Sequences

Purpose:

- create and manage reusable outreach flows
- review enrollments, due steps, and blocked items

### Tasks

Purpose:

- view internal follow-up tasks
- manage due work and Todoist sync state

### Imports

Purpose:

- upload CSVs
- monitor import runs
- review normalization and merge issues

### Settings

Purpose:

- connect Gmail, Outlook, and Todoist accounts
- review integration health
- manage operator profile and environment-level preferences

## Cross-cutting views

The product should also expose focused work queues within or across the primary surfaces.

Key queues:

- pending send approvals
- due follow-ups
- import issues needing review
- duplicate candidates
- integration failures

## Information hierarchy principles

### Contact-first model

Most important work should resolve back to a canonical contact.

Sequences, tasks, imports, and provider syncs are important, but the contact is the core object the operator thinks in.

### Actionable before exhaustive

The UI should prioritize:

- what needs action
- why it needs action
- what the next safe action is

before exposing every available detail.

### Traceability when needed

The operator should be able to inspect:

- source records
- merge history
- provider sync state
- outbound history

without those details overwhelming the primary workflow.

## Global interaction patterns

The first phase should support:

- global search by name and email
- fast-add contact
- fast-add follow-up
- clear empty states
- visible system status for imports, syncs, and send approvals

## First-phase success criteria

The product structure is successful if the operator can:

- connect accounts
- import or sync contacts
- open a contact and trust the unified record
- create a sequence and enroll people
- approve or send a follow-up
- see due work in one place

## Related docs

- [Contact Ingestion and Unification](./contact-ingestion-and-unification.md)
- [Contact Workspace](./contact-workspace.md)
- [Sequences and Outbound Workflow](./sequences-and-outbound-workflow.md)
- [Follow-Ups and Task Management](./follow-ups-and-task-management.md)
