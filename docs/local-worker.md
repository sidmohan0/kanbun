# Local Worker and workspace Durable Object

`apps/worker` runs the sync engine in a real SQLite-backed `WorkspaceDO`. Issue creation, title
updates, branch isolation, preview, and merge run through Cloudflare's local `workerd` runtime.
Production authentication and deployment are later work.

## Start in the devcontainer

```sh
./scripts/devcontainer.sh up
./scripts/devcontainer.sh dev
```

The development command starts both the Vite web shell on port 5173 and Wrangler on port 8787
inside the container. The web shell proxies `/sync` and `/__local` to the Worker. Use
`./scripts/devcontainer.sh url` to obtain the published localhost URL. The web app still shows the
brand shell; issue views are not implemented.

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

The default configuration disables workers.dev and preview URLs. There is no deployment workflow
or deploy script. `pnpm build` bundles and validates the Worker using Wrangler's `deploy --dry-run`;
it does not publish the Worker. Production access needs a later authenticated entry point.

## HTTP surface

| Method | Path                   | Purpose                                       |
| ------ | ---------------------- | --------------------------------------------- |
| POST   | `/__local/seed`        | Initialize local fixture data                 |
| GET    | `/sync/bootstrap`      | Bootstrap a branch-bound client               |
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
The client currently pulls after pushes or on explicit request; WebSocket pokes remain planned.

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
and default-disabled access. The four Chromium scenarios use the same Worker, real HTTP, and
browser IndexedDB. The Node HTTP layer serves assets and can truncate a real Worker acknowledgement
after commit; it does not execute business mutations.

Recovery evicts and recreates `WorkspaceDO` through the official harness API while preserving its
SQLite storage. This tests loss of instance memory and rerunning initialization. It does not
simulate a host crash or a deployed Cloudflare service. Fast Node SQLite suites retain the broader
engine contracts. The full verifier runs both layers in the devcontainer and CI.
