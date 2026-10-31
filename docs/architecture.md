# Architecture overview

Kanbun serves a React application and authenticated APIs from one Cloudflare Worker. A workspace's
SQLite Durable Object is its authoritative writer and synchronization endpoint. D1 holds the
account directory, memberships, invitations, and authentication state. Separate Document Durable
Objects persist and merge collaborative Yjs descriptions. R2 stores private recovery bundles.

## How an issue write flows

1. The browser runs a command optimistically and persists it in an IndexedDB mutation queue.
2. The client pushes queued commands over HTTP. The Worker resolves authenticated workspace and
   actor context before forwarding them to the workspace Durable Object.
3. The authority executes each mutation in a savepoint. Supported commands decide semantic events
   and apply shared reducers. Rejection rolls back that mutation. Acknowledgements and derived
   sync patches commit with the successful work.
4. WebSocket messages carry cursor hints. Clients pull authoritative patches, acknowledge their
   completed mutations, and reapply work that is still pending.

An interrupted acknowledgement can lead to the same mutation being retried. Persisted client
cursors prevent a retry from applying the command twice. Browser outboxes are partitioned by
workspace, actor, branch, and membership admission so a new identity cannot adopt an earlier
person's pending work.

## Storage and scope

Private-team membership and workspace authorization are enforced at the Worker and Durable
Object boundaries. Description synchronization has its own durable browser state and document
authorization. Workspace branches hold touched rows in an overlay while untouched reads follow
main. Human-reviewed merges resolve supported conflicts and retain retry receipts.

The semantic-event migration covers issue creation, property changes, labels, archive, description
publication, and discussion. Other mutations use the legacy patch path. Full-workspace historical
reconstruction remains outside the supported replay scope.

## Implementation references

- [Sync client and server](../packages/sync/)
- [Commands and reducers](../packages/mutators/)
- [Semantic event schemas](../packages/events/)
- [Worker and document authority](../apps/worker/src/)
- [Event replay contract](event-replay.md)
- [Workspace branch contract](workspace-branches.md)
- [Verification and evidence](verification.md)

The [locked specification](../SPEC.md) describes the intended broader architecture, including
agent execution, evidence-derived status, and time-aware views. Its implementation-status section
separates those design commitments from the current application.
