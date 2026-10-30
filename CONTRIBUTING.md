# Contributing

See the [README](README.md#development) for the pinned toolchain, setup, and verification commands.

Run `pnpm verify` before opening a PR. The same verifier runs in PR CI and retains per-check logs
and a machine-readable receipt. See [verification and drift reporting](docs/verification.md) for
individual commands and non-gating mechanical documentation reports.

## Changelog policy

Every PR that changes user-facing behavior must add a concise, nonblank `- ` bullet under the exact
`## [Unreleased]` heading in [CHANGELOG.md](CHANGELOG.md).

Use `Added`, `Changed`, `Fixed`, `Deprecated`, `Removed`, or `Security` as appropriate. Describe
observable behavior, including API, configuration, installation, and security changes. Record only
what the PR implements. Keep entries unreleased until release preparation moves them to a dated
version heading. A PR that only moves existing entries into a release section may use the exemption
below.

CI checks every committed PR change, with no path-based exemptions. It compares the full PR against
its actual target branch, including stacked PRs. An entry in an earlier commit of the same PR counts;
follow-up commits do not need duplicate entries. Entries from a parent PR do not cover a child PR.
Heading-only, blank, and historical-release edits do not satisfy the check. Reviewers must confirm
that the entry describes the change accurately.

## Exemptions

Tests, internal refactoring, and documentation or tooling changes with no user-facing effect may use
the `no-changelog` label. Include a nonempty reason in the PR body:

```text
Changelog exemption: Adds regression tests without changing runtime behavior.
```

Both the label and reason are required. Reviewers confirm the exemption. Bot PRs follow the same
policy. CI reruns when the description, labels, commits, or target branch change.

## Checking locally

```sh
pnpm test:changelog
pnpm changelog:check --base origin/main
```

The checker reads committed changes, not working-tree or staged entries. Fetch the target branch
first, and use that branch for `--base` when checking a stacked PR. Missing base refs and malformed
event data fail the check. Local checks do not consult GitHub labels unless an event file is supplied
with `--event`.

The changelog workflow runs on pull requests, so it does not require a base commit for the initial
push. It has no initial mode; run the local check once a committed PR and its base exist.

## GitHub setup

Once the workflow lands on `main`, create the `no-changelog` repository label and add `Changelog policy`
to the required checks in GitHub branch rules. The workflow alone does not prevent merging a failed
check.
