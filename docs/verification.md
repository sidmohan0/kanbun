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
pnpm verify preflight
pnpm verify recovery
pnpm verify docs
pnpm verify launch
pnpm test:verifier
```

With no subcommand, `pnpm verify` runs all checks. `doctor` checks the required toolchain and installed
dependencies; `check` runs formatting, lint, typechecking, tests, changelog-checker tests,
and current spec/archive validation. `build` runs the production build, `smoke` runs the seeded workspace fixture,
`recovery` runs the Chromium recovery integration tests, and `docs` validates the supported mechanical
documentation contracts. The complete run runs formatting, lint, types, and script/spec checks first, then four early browser
preflight cases before package tests, builds, seed checks, and the remaining browser cases. Preflight
covers startup and two-browser convergence, durable offline edits and comments, and revoked-access
mention validation. Each browser case executes once; `recovery` alone still runs the entire browser
suite. `check` retains the non-browser checks.

For machine-readable stdout, suppress pnpm's lifecycle banner:

```sh
pnpm --silent verify --json
pnpm --silent verify docs --json --output artifacts/verification
```

Phase starts, results, and elapsed seconds are printed to stderr while stdout remains a single JSON
receipt with `--json`. Each run creates a unique directory under `artifacts/verification/`, or the directory supplied with
`--output`. Commands write and validate their live logs and receipt in a container-local temporary
directory; completed evidence is then exported to that run directory. Receipt paths address the
exported logs. An export failure fails verification and preserves a failure receipt and logs in the
container-local `recoveryDirectory` returned by the command.
Reports record the command, toolchain, source identity, executed checks, outcomes, and
per-command logs. An uncommitted repository has no commit SHA; the receipt reports that state rather
than inventing one. A failed prerequisite, command, documentation check, or report write fails the run.
Skipped or unexecuted checks do not count as successful verification.

## PR and main checks

The complete verifier runs on every PR, including documentation-only changes. On pushes to `main`,
CI first runs fresh environment diagnosis. It may reuse a successful same-repository PR's full test
qualification only when the clean Git tree, all source fingerprints, lockfile, tool versions, Linux
architecture, OS identity, installed system-package inventory, and complete required suite match.
The lookup validates the Actions workflow/run/attempt and the tested commit against GitHub, retains
its original evidence archive and an explicit reuse receipt, and always builds fresh artifacts.
Missing, expired, inaccessible, unsupported, or mismatched evidence falls back to the complete
verifier. Local verification always runs fresh. Release builds, live smoke tests, migration guards,
and rollback checks remain fresh and separate.
Its workspace tests include [semantic issue replay and migration checks](event-replay.md).
All repository-owned workflows initialize the same devcontainer used locally and execute their
checks inside it. Run `./scripts/devcontainer.sh verify` from a host terminal or `pnpm verify` in
the container shell. Changelog and spec-lock commands receive GitHub metadata explicitly; the
scheduled documentation report runs in the same image and remains non-gating. Node-only policy,
health, and documentation jobs skip workspace/browser installation. Full jobs cache only package
and browser downloads, still performing frozen installation and environment diagnosis every time.
Superseded PR and main verification runs are canceled; deployments retain their separate serialized,
non-canceling lock. The spec-lock summary flags schema/configuration rollout needs without secrets;
the trusted release continues checking the actual deployed version and migration state.
GitHub Actions uploads its reports and logs after both successful and failed runs. The separate
spec-lock workflow compares changes against their base; the separate changelog workflow checks the
full committed PR and its exemption metadata. A current-tree verifier receipt does not replace those
history-aware checks.

## Browser recovery contracts

The browser suite tests both the actual React issue app and a focused sync recovery harness. Both
use the actual browser `IndexedDbPersister`, `httpTransport`, `SyncClient`, and
mutators through a local Cloudflare Worker and SQLite-backed `WorkspaceDO` in actual `workerd`.
The Node adapter serves assets, selects synthetic local identities, and can drop acknowledgements;
it does not execute business mutations. The suite verifies:

- An edit queued while the sync API is unavailable survives a page reload with the same client
  identity and pending mutation, then converges with a second browser context after reconnecting.
- A committed mutation whose HTTP acknowledgement is lost survives a page reload and Durable
  Object reactivation. Retrying the identical request produces no duplicate issue or additional sync-log
  rows, and the following issue receives the next number.
- A private workspace branch recovers an offline edit from IndexedDB and retries an unacknowledged
  HTTP mutation after Durable Object reactivation. Main stays unchanged, branch-created issues keep provisional
  numbers, and untouched branch reads receive later main changes. Main and branch tabs share one
  browser context and IndexedDB while using separate persistence keys.
- A human-reviewed merge with an edited conflict choice survives a lost HTTP acknowledgement and
  Durable Object reactivation. An identical retry returns the saved receipt, main converges through normal
  pull, the closed branch rejects access, and issue numbering advances only once.

The actual-app cases additionally cover form creation and inline renaming with two-session
convergence, durable offline reloads, real authority rejection and optimistic rollback (including
an overlapping pull), fractional ordering, one-writer tab handoff, and unavailable browser storage.
The app uses its maintained Vite configuration and entry point; tests do not inject an alternate UI.
Light, dark, and narrow-screen screenshots are retained with the product test.

These suites use synthetic local actors. Production authentication and a deployed Worker remain
outside their scope. Reactivation evicts the Durable Object instance
while preserving its SQLite storage; it does not simulate a host crash. Sync API outages leave the test page's assets
available; offline app-asset loading requires a separate product capability and test.

Run `pnpm test:recovery` directly or use `pnpm verify recovery` for a verification receipt. Playwright
JSON and HTML reports, failure traces, and failed-test server state are retained under
`artifacts/recovery/`, with early cases retained separately under `artifacts/recovery-preflight/`. The recovery runner keeps live browser artifacts in a unique container-local
temporary directory, then exports the completed reports and attachments after Playwright exits.
This avoids transient trace writes on shared host mounts. Test failures still export their evidence;
missing reports or failed exports fail the command. If export fails, the runner prints the retained
container-local directory for recovery. Filter cases with, for example,
`pnpm --filter @kanbun/verifier test:recovery app.spec.ts`.
Each test has its own database, origin, and Vite cache. CI installs Chromium
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

## Public launch checks

The launch profile evaluates the [launch criteria and evidence](launch-readiness.md) separately
from code health. A successful complete verifier run does not claim that cloud installation,
publication review or editorial approval has happened. The normal verifier validates the launch
registry's structure; the launch profile reports missing, blocked and stale evidence explicitly.

The devcontainer pins Gitleaks, Vale and OpenSSF Scorecard in
[`config/audit-tools.json`](../config/audit-tools.json). Image construction verifies each Linux
archive's SHA-256 before installing it. Rebuild the image when those pins change.

```sh
./scripts/devcontainer.sh exec pnpm audit:public secrets
./scripts/devcontainer.sh exec pnpm audit:public prose
```

The secret audit scans full available Git history and a snapshot of current tracked/unignored
files. A shallow checkout is rejected. Reports retain rule, path, line and commit references;
credential values, matched source text and scanner logs are omitted. The exact-value allowances
in `.gitleaks.toml` cover the RFC 6455 example nonce, a public historical Access audience and the
synthetic credential-parser fixture. The scanner's negative test proves an unrelated credential
still fails. A passing scan covers those rules; publication and ownership review remain required.

Vale checks the public README, evaluation guide and case study against the maintained writing
rules in `config/writing/Kanbun`. These rules enforce explicit phrases, with editorial review
covering accuracy, tone and usefulness. No external writing service is used.

CI runs both audits inside the shared devcontainer and retains their receipts under
`artifacts/launch/`. The manual Launch rehearsal workflow can run an isolated local install and
collect repository-security findings. Scorecard collection requires a read token and
`GITHUB_REPOSITORY=owner/repository`, supplied as remote environment variables to the devcontainer;
it records individual findings for review rather than granting launch approval from a score.
Unavailable repository settings remain unverified. None of these workflows deploy a public Worker.

Use [`scripts/check-local-install.sh`](../scripts/check-local-install.sh) for clean-checkout and
container replacement evidence. See [local lifecycle details](local-worker.md#persistence-reset-and-installation-proof).
