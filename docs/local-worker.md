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

## Persistence, reset, and installation proof

This local profile supports evaluation and development on one computer. The host checkout is
bind-mounted into the devcontainer. Worker SQL lives in `apps/worker/.wrangler/state`; replacing
the container retains that host directory. Browser drafts and cached state live separately in
the browser's IndexedDB and depend on the browser origin. Preserve the published localhost URL
when testing browser outbox recovery; a changed port creates a different browser origin.

To preserve a local workspace, stop the application and container, copy the entire
`apps/worker/.wrangler/state` directory to private storage, and record the source commit. Restore
it into a stopped checkout of the same source before starting. These local files include workspace
data. The hosted coherent backup and isolated restore procedure is documented in
[data recovery](data-recovery.md).

For a deliberate local reset, stop the dev server and remove `apps/worker/.wrangler/state` from
inside the container. Clear site data for the localhost origin in the browser as well; otherwise
its old queued edits can target the discarded workspace. Restart and initialize a new workspace.
Removing the container alone preserves the bind-mounted state. Removing the checkout removes it.

The installation rehearsal clones a committed, clean candidate into a temporary directory and
uses this same devcontainer. It initializes synthetic data, edits an issue through the HTTP API,
checks that Vite serves the web shell and Wrangler serves the workspace API directly, checks repeated
initialization, stops/restarts the container, replaces it, verifies stable issue
identity and contents, and tests reset in that disposable checkout:

```sh
./scripts/check-local-install.sh
```

Evidence is retained in `artifacts/launch/local/`. The browser suite separately proves the actual
issue UI. The rehearsal keeps its temporary checkout and stopped container for inspection; it prints
the checkout path. Remove those disposable resources after inspecting a failure or retaining the
evidence. It never resets this checkout's data. A successful run covers local evaluation only.

If setup fails, confirm Docker is running with free memory and disk for dependencies and Chromium.
Use `./scripts/devcontainer.sh status` to inspect this checkout. Port 5173 is
published on a dynamic localhost port; obtain it with `./scripts/devcontainer.sh url`. Inside the
container, another process occupying 5173 or 8787 must be stopped before `pnpm dev` can start.
After branch or dependency changes, run the frozen install inside the container; rebuild after
image or pinned-tool changes. Files created by root outside the standard setup can require host
ownership correction before the `node` container user can write them.

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
