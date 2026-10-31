# Durable workspace branches

A workspace branch holds proposed issue changes without editing the live workspace. This slice
supports issue creation and title-only updates, including human-reviewed merge and conflict
handling. The branch review UI remains planned. Hosted authentication and deployment are described
in the [hosted workspace guide](hosted-preview.md).

## Create and inspect

The sync server exposes `createBranch(actor, options)` and `getBranch(actor, branchId)`:

```ts
const branch = server.createBranch(alice, {
  id: uuidv7(),
  name: "plan/launch",
  scope: { teamIds: [teamId] },
});
const snapshot = server.bootstrap(alice, "launch-branch-client", branch.id);
```

Branch IDs are caller-generated UUIDv7 values. Repeating creation with the same ID, owner, name,
and scope returns the existing branch without appending another event. Reusing the ID with different
settings fails. Metadata records the actor owner, owning human, scope, status, creation timestamp,
and `baseSeq`, the main semantic event sequence at creation. `baseSyncSeq` separately captures the
main patch cursor so conflicts include legacy mutations that do not emit semantic events. New
branches have status `open`; a successful merge closes them as `merged`. Other status names remain
reserved.

`BranchCreated` is recorded on the branch itself. Main event history and projection cursors exclude
branch activity. The event log's sequence is global, so sequence gaps between a view's events are
expected; event sequence numbers and patch cursors remain separate domains.

## Ownership and scope

Active users and agents can create branches. A branch is private to its actor owner and, for an
agent-owned branch, that agent's captured human owner. Sibling agents do not gain access merely by
sharing the same human owner. Internal system operations remain trusted. Deactivating a member or
agent blocks its branch operations; an active human can still inspect their disabled agent's branch.

Team and project scopes constrain writes. Empty scope arrays add no restrictions beyond the current
actor's permissions. Scope IDs are validated at creation, and write scopes are checked within each
mutation savepoint. Team access and agent scopes still apply. Reads use the caller's current team
visibility; branch ownership does not bypass private-team membership. Main-only agent proposal
restrictions remain in place, while an agent in `propose` mode can write on its own branch.

## Storage and synchronization

`workspace_branch` stores metadata. `branch_row` stores only touched projection rows or tombstones,
keyed by branch, model, and row ID. Untouched reads fall through to live main. Once a row is touched,
its whole branch version shadows main until a later lifecycle step handles it. An issue created
on a branch has number zero as a placeholder. Main counters and business projection tables do not
change when the branch is edited.

The same shared issue reducers apply recorded events to either main or the branch store. Event
append, overlay writes, derived patches, and scope checks are atomic. A failure rolls all those
effects back; the normal mutation cursor still acknowledges the rejection.

Sync requests select a branch using `branchId`; omitting it selects main. Bootstrap accepts the
branch as its third server argument. Pull, push, and on-demand load carry it in their request;
HTTP transport uses a query parameter for reads and the JSON body for push. Branch success
responses identify their branch, and clients reject responses for another context before adopting
state. The local Worker exercises this protocol against a real SQLite Durable Object. Hosted
requests also require the authenticated workspace and membership context described in the
[hosted workspace guide](hosted-preview.md).

Every sync client ID is permanently bound to one actor and branch. A branch client cannot reuse a
main client ID, even to retry an old mutation. A `SyncClient` selects `branchId` at construction and
retains it for its lifetime. Persisted state records that identity, and a mismatched branch is
rejected before restoring an outbox. Older saved states without the field belong to main.
Use a distinct persistence key per workspace, user, and branch:

```ts
const client = new SyncClient({
  transport: httpTransport(origin),
  mutators,
  actor: alice,
  branchId: branch.id,
  persister: new IndexedDbPersister("kanbun", `${workspaceId}:${alice.id}:${branch.id}`),
});
```

A main patch cursor advances only for main effects. A branch patch cursor covers main and that
branch so untouched rows stay current. Pull skips main changes to shadowed rows; the first branch
patch for a row includes its full projection so a new row cannot arrive as a fragment. Branch event
and activity reads select that branch's own history. Causation can resolve visible main or same-
branch source patches, but never a sibling branch's history. Commit listeners receive the affected
branch alongside the patch cursor. `onCommit(listener)` observes only main; pass a branch ID as
the second argument to observe that branch plus live-main updates. Sibling branch writes do not
notify the subscription. These are trusted server callbacks; adapters authorize actors before
subscribing them to a branch.

Legacy commands, including mixed title-and-other-field updates, are rejected on branches before
they can write. Supported issue events are the only mutation effects accepted there. Configuration,
planning, rich-text, and other event families retain their existing main behavior until migrated.

## Preview and merge

Only an active human owner can preview or merge a branch, including the captured human owner of an
agent's branch. Agents cannot merge. Review rechecks current team visibility, and replay re-runs
the ordinary commands as the merger against current main. The branch's write scopes still apply.

```ts
const preview = server.previewBranch(alice, branch.id);
const request = {
  branchId: branch.id,
  mergeId: uuidv7(),
  expectedBranchHeadSeq: preview.branchHeadSeq,
  expectedMainSyncSeq: preview.mainSyncSeq,
  // Populate from explicit human choices if the preview contains conflicts.
  resolutions: [],
};
const result = server.mergeBranch(alice, request);
```

The preview groups proposed creation/rename changes by issue and includes both proposed and main
titles for conflicts. Every main patch on a touched issue since branch creation counts as a conflict,
including legacy writes. Missing, trashed, archived, and colliding main issues are also surfaced.
Untouched main rows remain live; changes to the decision's read set are not treated as conflicts.

Each conflict needs one explicit choice: `branch` replays that issue's proposed events, `main` skips
all of them, and `edit` replays them with a replacement final title. An edit resolution includes
`title`. A branch/edit choice still has to pass normal validation; it cannot overwrite an existing
issue with a creation event or rename a missing, trashed, or archived issue. Such validation errors
leave the merge unapplied. Other failed dependencies or projection constraints also roll back the
whole merge. The main choice can discard an inapplicable entity.

The request includes the exact branch head and main patch checkpoint from the preview. A change to
either requires a fresh preview, even if it affects an unrelated main row. Missing choices return
`{ ok: false, preview }` without changing main or closing the branch. Invalid, stale, or forbidden
requests throw. Conflict attempts leave the branch open for further editing and review.

A successful merge records `BranchMerged`, explicit `BranchConflictResolved` facts, and re-decided
issue events in one transaction. Issue numbers and current ordering are assigned on main. Event
causation points to the semantic merge fact. Main projections, counters, derived patches, branch
closure, overlay cleanup, and the durable receipt commit together. Closed branches reject sync
reads and writes; `getBranch` remains available to their owner.

Persist the request's caller-generated UUIDv7 `mergeId` and retry the same request after an uncertain
response. The `branch_merge` receipt returns the original result, including after reopening SQLite,
without allocating another number or appending events. Reusing the ID or closed branch with different
settings is rejected. The same active human must retry it. Resolution order is normalized for this
comparison. An older branch without a recorded patch baseline cannot be safely merged; recreate it.
The migration preserves its overlay and history rather than guessing a baseline.

The local Worker exposes these engine methods as HTTP routes. The browser recovery fixture forwards
requests to that Worker. Production authentication, deployment, and review UI remain to be implemented.

## Verification

Real SQLite tests cover upgrade preservation, durable overlays, live fallback, tombstones, and
change capture. Server integration checks cover ownership, team and project scopes, agent proposal
mode, idempotency, branch-bound clients, rollback, and complete first-touch pulls. Client tests
reject mismatched saved state and response contexts. A Chromium recovery scenario uses real
IndexedDB and HTTP across page reloads, Durable Object reactivation, and a lost acknowledgement, while
asserting that main stays unchanged.

Merge integration checks cover the specification's 500-event clean merge, semantic and legacy
conflicts, explicit choices, stale previews, current permissions, atomic rollback, and durable retry
receipts. Browser recovery checks exercise a committed merge with a lost HTTP response, Durable
Object reactivation, an identical retry, and convergence through the main client's normal pull path.
