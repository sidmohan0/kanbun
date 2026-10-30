# Semantic issue event replay

The first semantic event slice covers issue creation and title-only updates. `issueCreate` decides
an `IssueCreated` event; `issueUpdate` with only `patch.title` decides `IssueTitled`. The existing
command names and argument shapes remain available to sync clients and generated tools.

Decisions read configuration, validate permissions and arguments, and return typed facts without
writing projections. `@kanbun/events` validates the closed event vocabulary and its envelopes.
The authoritative decision resolves the issue number, ordering values, initial state, and supporting
label and subscription identifiers before the event is recorded. The client uses a provisional
number of zero until confirmation.

Within one mutation savepoint, the server appends the event to `event_log`, applies the shared
reducer, captures derived patches in `sync_log`, and checks agent scopes. A failure rolls back the
event, projections, counter, and derived patches. The existing persisted client mutation cursor
makes a retry of the same `(clientId, mutationId)` a no-op, including after a database reopen.

Committed event envelopes contain the authoritative actor, transaction, timestamp, sequence, and
mutation identity. Each mutation can emit multiple events distinguished by `eventIndex`.
`branchId` selects main or a durable workspace branch for issue creation and rename. Session and source-reference
fields are reserved and currently null. Existing actor types are preserved during this migration.

`applyIssueEvent` replays recorded facts through the same reducer in the client's memory store and
the server's SQLite store. It uses the recorded event timestamp, sequence, and issue number; it does
not read a clock, generate identifiers, or allocate a number. Replay assumes the prerequisite team
and configuration projection is present. It rebuilds into a fresh issue projection, rather than
applying a creation event twice to a populated store.

`SyncServer.events(actor, { since, entityId, limit })` reads visible committed events in ascending
event-sequence order. Team membership, an agent's owner, and agent team scopes filter the history.
The event cursor is separate from the existing patch-based sync cursor. `sync_log.eventSeq` links
derived patches to their semantic event; legacy writes have no event link.

The existing mutation option `causationSeq` continues to accept a sync-log patch sequence.
Before recording a semantic event, the authority resolves that visible patch's `eventSeq` and
stores the semantic sequence in the event's `causationSeq`. A legacy patch or an unavailable
source has no semantic cause, so the event stores null. Derived sync patches retain the original
patch-based reference. Optimistic events use null until the authority can resolve their cause.

`BranchCreated` records a branch's ownership, scope, and separate main event and patch bases. Issue events on that
branch are applied to durable overlay rows. See [workspace branches](workspace-branches.md) for
ownership, live-main reads, client identity, and cursor behavior.

`BranchMerged` records the accepted source event sequences and skipped issues. Merging re-runs
commands as the human merger against current main, then applies newly finalized issue events.
Their semantic `causationSeq` points directly to `BranchMerged`; it does not pass through the
patch-based mutation option. `BranchConflictResolved` records each explicit branch, main, or edited
title choice. These lifecycle events are visible to the captured human owner. Derived issue patches
have no source patch cause; their `eventSeq` links to the newly recorded issue facts.

New creation facts retain top/bottom placement intent so merging can recompute ordering on current
main. Older creation facts remain decodable and use bottom placement when re-decided. This field is
event metadata and is not an issue projection column.

Issue `createdSeq` and `updatedSeq` identify semantic creation and the latest semantic update.
The migration preserves existing rows with zero sequence metadata and does not invent historical
events. Other issue updates, including mixed title-and-other-field updates, remain on the legacy
path and do not advance semantic sequence metadata. The event log therefore reconstructs the
supported create/rename flow, rather than the entire workspace history at this stage.

## Verification

The full verifier includes model migration tests and semantic issue integration tests. The fixed
create/rename golden log is authored independently of command execution. Replaying it in memory
and SQLite must produce identical projections, with explicit expected titles, numbers, timestamps,
sequences, labels, and subscriptions.

Additional integration checks exercise durable retry after reopening SQLite, rollback after a real
late projection-write failure, and event-history privacy. Existing Chromium tests continue to cover
offline edit recovery and a lost HTTP acknowledgement through the public sync client, local Worker,
and SQLite Durable Object. Runtime tests also prove nested rollback and migration startup in `workerd`.

## Description publication

Human description edits synchronize Yjs state through the authorized document route. The private
document adapter publishes `IssueDescribed` with the plain-text mirror and a hash of the complete
Yjs state, including deletions. Its reducer updates the issue and team-scoped document metadata.
Ordinary sync mutations cannot supply a trusted document hash or bypass body synchronization.

The document body is durable before the workspace acknowledges its mirror. Publication retries
repair a missing workspace event without duplicating an acknowledged state; the durable editor
identity remains the event actor. Binary Yjs state stays in DocumentDO storage. Description changes
are initially main-only; the existing create/rename branch merge contract stays unchanged.

The remaining vocabulary, complete workspace replay, and branch review UI remain later steps.
The [hosted preview](hosted-preview.md) provides deployment and owner authentication.
