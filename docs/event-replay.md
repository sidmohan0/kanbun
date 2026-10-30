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
`branchId` is present from the start; this slice executes only `main`. Session and source-reference
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
offline edit recovery and a lost HTTP acknowledgement through the public sync client.

This completes the first event flow. The remaining vocabulary, complete workspace replay, branch
execution and merging, and the Cloudflare Worker are later implementation steps.
