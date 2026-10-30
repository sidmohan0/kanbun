<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/svg/lockup-reverse-on-ink.svg" />
  <img src="brand/svg/lockup-color-on-bone.svg" alt="kanbun" width="360" />
</picture>

# kanbun

**The issue tracker where agents pick up the work.**

An AI-native, local-first issue tracker for people and agents. Built around a real-time sync engine
and designed to run entirely on Cloudflare (Workers, Durable Objects, D1, R2, Queues, Email Workers).

Contributions must not include third-party assets (icon sets, illustrations, CSS) or code derived from any other product's source; pull requests that do are closed.

## Layout

```
apps/
  web/        React issue list, details, and collaborative descriptions over the local sync client
  worker/     HTTP sync, notifications, SQLite WorkspaceDO, and Yjs DocumentDO bodies
packages/
  events/     Typed semantic issue events and their validated envelopes
  model/      Drizzle schema: one definition of every entity, for D1 and for DO SQLite
  sync/       The sync engine: protocol, server push/pull/log, client object pool + mutation queue + rebase
  mutators/   Every write in the system, defined once, run on the client (optimistic) and in the DO (authoritative)
  seed/       Deterministic seed data (5k issues) used by tests and as the sync-performance fixture
  verifier/   Deterministic repository checks and retained execution evidence
```

Current workspace packages:

<!-- workspace-inventory:start -->

- `apps/web`
- `apps/worker`
- `packages/events`
- `packages/model`
- `packages/mutators`
- `packages/seed`
- `packages/sync`
- `packages/verifier`

<!-- workspace-inventory:end -->

The local Worker runs the existing engine in a SQLite-backed `WorkspaceDO`, with HTTP sync and
branch APIs. Runtime tests and browser recovery checks use actual `workerd`; fast engine tests and
the seed still use `node:sqlite`. The web app lists, creates, and renames issues, with
[status, priority, assignee, labels, and reversible archive controls](docs/ux/issue-properties.md).
IndexedDB-backed offline recovery, automatic cross-browser updates, and visible sync/rejection
state apply to these issue changes. See the
[local issue flow](docs/ux/issues.md). A [protected hosted preview](docs/hosted-preview.md) uses
Cloudflare Access, actual user/workspace context, and a D1 directory. Native sign-in and public
onboarding remain planned. [Issue details](docs/ux/issue-details.md) add collaborative descriptions
in a separate SQLite DocumentDO, with Yjs merging and durable browser recovery. See
[local Worker development](docs/local-worker.md).

Issue creation, human property changes, labels, archive, and document publication record semantic
events and apply shared reducers. Their recorded history can reproduce the supported projections
in memory and SQLite. Other mutations retain a legacy path during the incremental migration. See
[semantic event replay](docs/event-replay.md) for the supported scope and invariants.

The same create/rename flow also supports [durable workspace branches](docs/workspace-branches.md).
Branch rows survive restarts without changing main, while untouched reads follow live main.
Human owners can preview and merge the supported changes with explicit conflict choices and durable
retry receipts. The branch review UI remains planned.

The [team readiness checklist](docs/team-readiness.md) tracks the remaining product and operational
gates before an invited team pilot.

## How a write flows

1. The client runs a command against its in-memory object pool and re-renders. For migrated commands, a read-only decision produces events that a shared reducer applies optimistically. The command is appended to a persisted queue.
2. The queue is pushed to `/sync/push`; the Worker forwards it to the workspace's Durable Object.
3. The authority runs the same command inside a SQLite transaction (one savepoint per mutation, so a rejected one leaves nothing behind). Migrated commands record finalized semantic events and apply their reducers, including server-owned issue numbers. Derived patches enter `sync_log` with provenance; main-branch commits send cursor-only WebSocket notifications.
4. Clients pull `/sync/pull?since=<seq>` after notifications and socket reconnects, apply the log, drop confirmed mutations from their queue and re-apply any still pending. Socket messages never carry rows or replace HTTP synchronization.

Everything else (notifications, email, webhooks) hangs off the change events the DO emits to Queues.

## Development

The [devcontainer](.devcontainer/devcontainer.json) is the standard environment for local development
and every repository-owned CI workflow. It pins the Linux image and Node version, installs pnpm from
`package.json`, and runs a frozen workspace install, Chromium setup, and `pnpm verify doctor`.
Docker and host Node.js are needed to bootstrap the pinned devcontainer CLI; repository commands
then run inside the container. VS Code's **Dev Containers: Reopen in Container** and GitHub Codespaces
use the same configuration.

```sh
# With Docker running:
./scripts/devcontainer.sh up
./scripts/devcontainer.sh verify
./scripts/devcontainer.sh dev
# In another terminal, print the published localhost URL:
./scripts/devcontainer.sh url
```

For Colima, start a project runtime with `colima start --profile kanbun --cpu 4 --memory 6 --disk 40
--activate=false`. The wrapper uses `colima-kanbun` if the default Docker runtime is unavailable;
it does not change the global Docker context. Explicit `DOCKER_CONTEXT` and `DOCKER_HOST` settings
are respected. The web shell listens inside the container and is published to a dynamically chosen
host port on `127.0.0.1`. Editors can also forward container port 5173.

Use `./scripts/devcontainer.sh exec <command...>` for any repository command, `shell` for a container
shell, and `stop` to stop this checkout's containers while preserving data. After changing the image
or browser dependency, use `rebuild`. After changing branches or the lockfile, run a frozen install
inside the container. Container and native dependencies must use separate checkouts; a native
checkout is an optional troubleshooting environment, rather than CI proof. The devcontainer is a
development environment; the separate [preview profile](docs/hosted-preview.md) builds and deploys
the app to Cloudflare with authenticated workspace routing.

pnpm remains the package manager for both environments: use one root lockfile and declare internal
dependencies with `workspace:*`. Run installs from the repository root, use
`pnpm --filter <package-name> add <dependency>` to update an individual package, and commit the
manifest and lockfile together.

The commands below run in the container shell, or through `./scripts/devcontainer.sh exec`.
For optional native troubleshooting, use a separate checkout with the Node version in `.nvmrc` and
pnpm `10.28.0`, as declared in `package.json`.

```
pnpm install --frozen-lockfile
pnpm --filter @kanbun/verifier exec playwright install --only-shell chromium
pnpm verify       # runs the complete verifier and retains reports and logs
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:changelog
pnpm build
pnpm seed         # builds the 5k-issue workspace in memory and reports bootstrap size and timing
pnpm dev          # web shell on :5173; local Worker on :8787
```

Run `pnpm format` to format maintained source and configuration. The formatter excludes the locked
specification, its archives, generated migrations, the dependency lockfile, and exported brand assets.
ESLint checks JavaScript and TypeScript correctness, with React Hooks rules for the web app.

CI initializes the same devcontainer and runs the complete verifier on every pull request and push to `main`, retaining
reports even after failures. The verifier checks the toolchain, formatting, lint, types, tests,
production build, seed smoke run, browser recovery contracts, current spec archive, and mechanical documentation contracts.
See [verification and drift reporting](docs/verification.md) for commands, evidence, and the daily
mechanical documentation report. The separate spec-lock check also runs on every pull request and push to `main`.
Changelog, spec-lock, and scheduled documentation commands also execute inside the devcontainer.
Host runner steps only bootstrap the container and handle GitHub event files, summaries, and artifacts.
Before the first commit, run `pnpm spec:check --initial`; once a base commit exists, use
`pnpm spec:check <base-ref>` to validate changes against it.

The `Changelog policy` PR check requires an added entry under `[Unreleased]` in
[CHANGELOG.md](CHANGELOG.md), or an explicit exemption. See [CONTRIBUTING.md](CONTRIBUTING.md) for the
entry format, exemption requirements, and local checking commands.

Review dependency advisories with `pnpm audit`, or `pnpm audit --prod` for runtime dependencies.
The current Drizzle Kit loader pulls in esbuild `0.18.20`, which has a
[development-server advisory](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99).
The loader uses esbuild's transform API, and this repo uses Drizzle Kit only for migration generation;
neither invokes the affected server API. No override or audit suppression is configured. Reassess this
finding when updating Drizzle Kit or adding commands that use esbuild's server.

## Brand

The [logo kit and usage guidelines](brand/KIT.txt) cover the SVG masters, web icons, and social image.
Use the supplied light and dark lockups with their existing clear space and proportions. The palette
is Bone & Cinnabar, with Cinnabar Bright on Ink backgrounds; Shippori Mincho SemiBold is used for the
wordmark and headlines, and Inter for the product UI.

## Spec

[`SPEC.md`](SPEC.md) is the locked, single source of truth (currently v1.0). Every version is archived in full under [`docs/spec/`](docs/spec/), and `pnpm spec:check` (also run in CI) refuses any change to the body that is not a version bump with an archived copy of the outgoing version. Its "Implementation status" section says which parts of the spec the code reflects.

## License

Copyright 2026 Sid Mohan. Licensed under the [Apache License, Version 2.0](LICENSE).
