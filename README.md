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
  web/        React + Vite web shell; routing and Worker integration are planned
packages/
  model/      Drizzle schema: one definition of every entity, for D1 and for DO SQLite
  sync/       The sync engine: protocol, server push/pull/log, client object pool + mutation queue + rebase
  mutators/   Every write in the system, defined once, run on the client (optimistic) and in the DO (authoritative)
  seed/       Deterministic seed data (5k issues) used by tests and as the sync-performance fixture
  verifier/   Deterministic repository checks and retained execution evidence
```

Current workspace packages:

<!-- workspace-inventory:start -->

- `apps/web`
- `packages/model`
- `packages/mutators`
- `packages/seed`
- `packages/sync`
- `packages/verifier`

<!-- workspace-inventory:end -->

The Worker (`apps/worker`: Hono router, WorkspaceDO with SQLite + sync log + WebSocket hub, DocumentDO with Yjs) is not written yet. The engine is exercised today over `node:sqlite` by the tests and the seed; the Durable Object driver in `packages/sync/src/server/driver.ts` is the only piece that changes when it moves into the Worker.

## How a write flows

1. The client runs a mutator against its in-memory object pool and re-renders. The mutation is appended to a persisted queue.
2. The queue is pushed to `/sync/push`; the Worker forwards it to the workspace's Durable Object.
3. The DO runs the same mutator inside a SQLite transaction (one savepoint per mutation, so a rejected one leaves nothing behind), assigns server-owned fields (issue numbers), appends to `sync_log` with who did it and why, and pokes every connected WebSocket.
4. Clients pull `/sync/pull?since=<seq>`, apply the log, drop confirmed mutations from their queue and re-apply any still pending.

Everything else (notifications, email, webhooks) hangs off the change events the DO emits to Queues.

## Development

Use the Node version pinned in `.nvmrc` and pnpm `10.28.0`, as declared in `package.json`.
With nvm installed, `nvm install` and `nvm use` select the same Node version as CI.

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
pnpm dev          # web shell on :5173 (proxies /sync to :8787 once the Worker exists)
```

Run `pnpm format` to format maintained source and configuration. The formatter excludes the locked
specification, its archives, generated migrations, the dependency lockfile, and exported brand assets.
ESLint checks JavaScript and TypeScript correctness, with React Hooks rules for the web app.

CI runs the frozen install and complete verifier on every pull request and push to `main`, retaining
reports even after failures. The verifier checks the toolchain, formatting, lint, types, tests,
production build, seed smoke run, browser recovery contracts, current spec archive, and mechanical documentation contracts.
See [verification and drift reporting](docs/verification.md) for commands, evidence, and the daily
mechanical documentation report. The separate spec-lock check also runs on every pull request and push to `main`.
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
