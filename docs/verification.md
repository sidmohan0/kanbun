# Verification and drift reporting

The verifier executes the repository's checks and keeps the evidence for each run. It does not
install tools, change source files, update baselines, or publish anything.

## Local commands

Use the Node version in `.nvmrc`, the pnpm version in `package.json`, and a frozen dependency install.
Install the pinned Playwright Chromium headless shell once before running browser recovery checks:

```sh
pnpm --filter @kanbun/verifier exec playwright install --only-shell chromium
```

```sh
pnpm verify
pnpm verify doctor
pnpm verify check
pnpm verify build
pnpm verify smoke
pnpm verify recovery
pnpm verify docs
pnpm test:verifier
```

With no subcommand, `pnpm verify` runs all checks. `doctor` checks the required toolchain and installed
dependencies; `check` runs formatting, lint, typechecking, tests, changelog-checker tests,
and current spec/archive validation. `build` runs the production build, `smoke` runs the seeded workspace fixture,
`recovery` runs the Chromium recovery integration tests, and `docs` validates the supported mechanical
documentation contracts. The complete run includes browser recovery; `check` retains the faster
non-browser checks.

For machine-readable stdout, suppress pnpm's lifecycle banner:

```sh
pnpm --silent verify --json
pnpm --silent verify docs --json --output artifacts/verification
```

Each run creates a unique directory under `artifacts/verification/`, or the directory supplied with
`--output`. Reports record the command, toolchain, source identity, executed checks, outcomes, and
per-command logs. An uncommitted repository has no commit SHA; the receipt reports that state rather
than inventing one. A failed prerequisite, command, documentation check, or report write fails the run.
Skipped or unexecuted checks do not count as successful verification.

## PR and main checks

The complete verifier runs on every PR and push to `main`, including documentation-only changes.
Its workspace tests include [semantic issue replay and migration checks](event-replay.md).
GitHub Actions uploads its reports and logs after both successful and failed runs. The separate
spec-lock workflow compares changes against their base; the separate changelog workflow checks the
full committed PR and its exemption metadata. A current-tree verifier receipt does not replace those
history-aware checks.

## Browser recovery contracts

The recovery suite uses the actual browser `IndexedDbPersister`, `httpTransport`, `SyncClient`, and
mutators against a local HTTP adapter over a file-backed SQLite `SyncServer`. It verifies:

- An edit queued while the sync API is unavailable survives a page reload with the same client
  identity and pending mutation, then converges with a second browser context after reconnecting.
- A committed mutation whose HTTP acknowledgement is lost survives a page reload and SQLite
  reopening. Retrying the identical request produces no duplicate issue or additional sync-log
  rows, and the following issue receives the next number.

This is a browser integration harness, with synthetic fixture actors. It does not exercise product
UI, production authentication, or a deployed Worker. Sync API outages leave the test page's assets
available; offline app-asset loading requires a separate product capability and test.

Run `pnpm test:recovery` directly or use `pnpm verify recovery` for a verification receipt. Playwright
JSON and HTML reports, failure traces, and failed-test server state are retained under
`artifacts/recovery/`. Each test has its own database, origin, and Vite cache. CI installs Chromium
and its system dependencies before running the complete verifier, then uploads recovery evidence
on success or failure. The verifier itself does not install browsers.

## Daily documentation report

The documentation report runs daily at 06:00 UTC and can also be dispatched manually. It runs
`pnpm verify docs`, retains the JSON receipt and logs, and summarizes mechanical findings. The docs
step is non-gating, and this workflow has no pull-request trigger. The same mechanical contracts
remain part of the deterministic verifier in PR CI.

Mechanical checks cover supported local links and assets, explicit pnpm script references,
workspace inventory, shared product metadata, and changelog structure. Planned paths in prose and
the locked spec are not treated as missing implementation. An empty `[Unreleased]` section after a
release is valid; the PR changelog check enforces new entries or explicit exemptions for changes.

Mechanical checks cannot determine whether a prose claim correctly describes behavior or whether
the implementation fulfills the entire specification. Historical changelog entries describe their
release, not necessarily the current implementation. Semantic auditing is deferred: there are no
model calls, API-key prerequisites, or semantic findings in the CI path.

Scheduled workflows begin running only after they are present on the default branch.
