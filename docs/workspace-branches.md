# Durable workspace branches

A workspace branch holds proposed issue changes without editing the live workspace. This slice
supports issue creation and title-only updates. Branch merging, conflict handling, branch review
UI, and Cloudflare deployment remain later work.

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
and `baseSeq`, the main semantic event sequence at creation. New branches have status `open`.
Other status names are reserved; this slice exposes no status-transition API.

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
state. The fixture HTTP adapter exercises this protocol; the production Worker is not implemented.

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

## Verification

Real SQLite tests cover upgrade preservation, durable overlays, live fallback, tombstones, and
change capture. Server integration checks cover ownership, team and project scopes, agent proposal
mode, idempotency, branch-bound clients, rollback, and complete first-touch pulls. Client tests
reject mismatched saved state and response contexts. A Chromium recovery scenario uses real
IndexedDB and HTTP across page reloads, database reopening, and a lost acknowledgement, while
asserting that main stays unchanged.
