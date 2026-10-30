# Local Worker and workspace Durable Object

`apps/worker` runs the sync engine in a real SQLite-backed `WorkspaceDO`. Issue creation, title
updates, branch isolation, preview, and merge run through Cloudflare's local `workerd` runtime.
The separate [hosted preview](hosted-preview.md) uses authenticated identity and workspace routing.

## Start in the devcontainer

```sh
./scripts/devcontainer.sh up
./scripts/devcontainer.sh dev
```

The development command starts both the Vite web shell on port 5173 and Wrangler on port 8787
inside the container. The web shell proxies `/sync` and `/__local` to the Worker. Use
`./scripts/devcontainer.sh url` to obtain the published localhost URL. Open the issue list to create
issues and edit their titles directly in the app; the sidebar identifies the
synthetic Alice user. On a first visit, use **Initialize local workspace** if prompted, or initialize
it from the terminal below.

Initialize the local workspace from another terminal:

```sh
./scripts/devcontainer.sh exec curl -fsS -X POST \
  -H 'Content-Type: application/json' --data '{}' \
  http://127.0.0.1:8787/__local/seed
./scripts/devcontainer.sh exec curl -fsS \
  'http://127.0.0.1:8787/sync/bootstrap?clientId=local-inspection'
```

Seeding returns the team and shared issue IDs. It creates synthetic Alice and Bob members and a
public `REC` team. Repeating it preserves existing data and identities. `{ "seedIssue": false }`
initializes an empty team instead. Wrangler's local state lives under `apps/worker/.wrangler/`,
which is ignored by Git. Restarting the development server retains that state.

## Local identity boundary

The committed Wrangler configuration sets `LOCAL_DEV` to `"false"`; sync and local seed routes
return 503 in that configuration. The development script explicitly supplies `LOCAL_DEV:true`.
Both the outer Worker and the Durable Object require that value before serving workspace APIs.

In local mode, `X-Kanbun-Local-Actor: alice` or `bob` selects a synthetic user; Alice is the default.
An unknown name is rejected. Actor values in request bodies are rejected, and inactive members
cannot use sync routes. Existing team permissions, branch ownership, and write scopes still apply.
All requests target the fixed `local` workspace. This is fixture identity selection, not production
authentication or workspace routing.

The default configuration disables workers.dev and preview URLs. `pnpm build` builds the web assets
and validates both local and preview Workers using Wrangler's `deploy --dry-run`; it does not
publish either Worker. The explicit preview deployment command uses a separate authenticated
configuration and never enables local fixture identities.

## HTTP surface

| Method | Path                   | Purpose                                       |
| ------ | ---------------------- | --------------------------------------------- |
| POST   | `/__local/seed`        | Initialize local fixture data                 |
| GET    | `/api/context`         | Describe the local identity before seeding    |
| GET    | `/sync/bootstrap`      | Bootstrap a branch-bound client               |
| GET    | `/sync/connect`        | Upgrade a main-branch notification socket     |
| GET    | `/sync/pull`           | Pull visible patches after `since`            |
| GET    | `/sync/load`           | Load an on-demand model by parent             |
| POST   | `/sync/push`           | Execute a mutation batch                      |
| POST   | `/sync/branch/create`  | Create a durable branch                       |
| GET    | `/sync/branch/get`     | Inspect owned branch metadata                 |
| GET    | `/sync/branch/preview` | Preview changes and conflicts                 |
| POST   | `/sync/branch/merge`   | Merge reviewed changes with a durable receipt |
| GET    | `/sync/events`         | Read scoped semantic history                  |
| GET    | `/sync/activity`       | Read scoped patch provenance                  |

Reads select a branch with the `branchId` query parameter; sync writes carry it in JSON. Omitting
it selects main where supported. Branch get/preview require an explicit branch ID. Query/body
schemas reject unknown fields, repeated query keys, invalid models and cursors, and malformed
mutation envelopes. Wrong methods return 405. Domain errors retain their normal HTTP status.

## Notifications and reconnect catch-up

The main-branch client opens a same-origin WebSocket at
`/sync/connect?clientId=<stable-client-id>&branchId=main`. The route checks local mode, active
membership, the client's actor/branch binding, and any supplied Origin before accepting it.
Other branches are rejected by this notification endpoint. Branch HTTP APIs remain available.

The socket sends only `{ "type": "poke", "seq": <main-patch-cursor> }`, initially and after a
main commit advances the cursor. Private branch writes, retries, and rejected-only batches do not
produce a new main hint. SQLite and the normal pull API remain authoritative. Each broadcast
rechecks membership and client binding, closing a socket whose access has been revoked.

The browser automatically pushes its queued work before pulling on a new hint or socket open.
Opening always catches up, even when notifications were missed while disconnected. Hints received
during an older pull queue a fresh pass. Invalid, duplicate, and older hints are ignored. The
existing reconnect library supplies bounded retry delays; a socket outage alone does not change
the save status of successful HTTP writes. Refresh, focus, and online events still request sync.

Only the tab holding the IndexedDB writer lease opens a socket. A waiting tab opens one after
taking over; a failed storage read opens none. The Durable Object uses the WebSocket Hibernation
API with serialized identity attachments, so eviction can preserve connections without retaining
an in-memory client list or a background timer. The Vite proxy forwards WebSocket upgrades.

## Runtime verification

```sh
./scripts/devcontainer.sh exec pnpm --filter @kanbun/worker test
./scripts/devcontainer.sh exec pnpm test:recovery
./scripts/devcontainer.sh verify
```

The shared adapter uses Wrangler's official `createTestHarness()` against the maintained Worker
configuration. Each harness has isolated storage and explicitly enables local mode. Tests execute
HTTP and SQL in actual `workerd`, rather than importing Worker handlers into Node. Storage
inspection uses the harness API; the Worker exposes no SQL inspection route.

Worker tests prove fresh migrations, idempotent initialization, client convergence, per-mutation
rollback within a mixed batch, branch privacy, durable merge receipts, strict request validation,
and default-disabled access. The SDK Chromium scenarios use the same Worker, real HTTP, and
browser IndexedDB. The Node HTTP layer serves assets and can truncate a real Worker acknowledgement
after commit; it does not execute business mutations.

The actual React app also has browser coverage for create/rename convergence, persisted offline
edits, authoritative rejection and rollback, same-browser tab handoff, and storage failures. The
app converges across independent browser contexts without focus or **Refresh**. Recovery checks
drop notifications, interrupt the socket, and prove automatic catch-up on reopening, then verify
live delivery after Durable Object hibernation. One tab at a
time owns the stable Alice/main outbox; another tab waits and automatically restores the queue
after the owner closes. Independent browser contexts use independent clients.

Recovery evicts and recreates `WorkspaceDO` through the official harness API while preserving its
SQLite storage. This tests loss of instance memory and rerunning initialization. It does not
simulate a host crash or a deployed Cloudflare service. Fast Node SQLite suites retain the broader
engine contracts. The full verifier runs both layers in the devcontainer and CI.
