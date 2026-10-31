# Public launch readiness

The launch registry connects the public-release requirements to their verification methods,
source scopes, responsible owners, procedures, and evidence. It follows the implementation plan
for local evaluation, independent Cloudflare installation, operations, documentation, security,
implementation help, and portfolio presentation.

The registry is [criteria.json](launch/criteria.json). Every requirement has stable acceptance
criterion IDs such as `RUN-01.02`. Edit assertions and procedures through normal reviewed PRs.
Existing IDs retain their meaning; a materially different promise needs its own criterion.

## Run the report

```sh
./scripts/devcontainer.sh verify launch
./scripts/devcontainer.sh exec pnpm --silent verify launch
./scripts/devcontainer.sh exec pnpm --silent verify launch --json --evidence artifacts/launch/evidence.json
```

The first command evaluates mechanical checks and collects retained receipts from the maintained
secret/prose audits, local lifecycle rehearsal, and the latest matching full-verifier run. It does
not execute those producers. Missing receipts remain explicit. The `--evidence` command evaluates an explicit
evidence manifest, which can include collected records and reviewer/live-account records. The command
without `--json` prints criterion IDs, statuses, and missing-evidence reasons for direct review.
All commands retain a normal verifier receipt and a nested
`launch` result in the launch step. A report with unmet requirements exits nonzero. Commands do
not deploy, send mail, change repository settings, create releases, or mark reviews complete.

Ordinary `./scripts/devcontainer.sh verify` validates the registry structure and runs the code
checks. Its passing result establishes code qualification. Public launch readiness is a separate
profile because live-account rehearsals and accountable review judgments remain required. A green ordinary
CI run does not claim that the repository is ready for public promotion.

## Implementation and verification order

| Priority | Requirement                      | Automated verification                                           | External evidence                                                                                         |
| -------- | -------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 0        | PUB-01 Publication safety        | Current-tree/history scanner results                             | Sanitized finding resolution, rotation where needed, privacy and provenance review                        |
| 0        | PUB-02 Independent configuration | Installer file checks and configuration/workflow tests           | Plan and fork-safety rehearsal                                                                            |
| 0        | PUB-03 Accurate public claims    | Existing product scenarios and spec-lock checks                  | Claim-to-behavior review across README, spec, and guides                                                  |
| 1        | RUN-01 Local installation        | Container and lifecycle procedure checks                         | Clean setup, repeat initialization, issue operations, stop/restart, replacement, reset, newcomer review   |
| 1        | RUN-02 Cloudflare installation   | Installer plan and default-safety tests                          | Separate-account deployment, actual sign-in/member flow, persistence/retry, separate GitHub App setup     |
| 1        | OPS-01 Operating lifecycle       | Existing recovery and migration tests                            | Populated supported-version upgrade, isolated restore, operator-guide review                              |
| 2        | DOC-01 README                    | Links, command references, metadata and writing rules            | Accuracy, screenshot, tone and newcomer clarity review                                                    |
| 2        | GOV-01 Support and contribution  | Policy/template checks and applicable repository-security checks | Actual GitHub settings/private-reporting evidence and policy review                                       |
| 2        | BIZ-01 Implementation help       | Documentation and contact-link checks                            | Deliverables, prerequisites and maintenance-scope review                                                  |
| 2        | PORT-01 Portfolio presentation   | Case-study artifact and documentation checks                     | Attribution, synthetic walkthrough, and technical-measurement review                                      |
| 3        | REL-01 Qualified release         | Complete same-source devcontainer receipt with bound logs        | Separate history-aware PR checks, release notes, candidate/tag identity and evidence applicability review |

Complete publication safety and configuration work first. Local and cloud installation can then
proceed independently alongside documentation. Rehearse operating procedures against populated
data, review public presentation, and evaluate the final candidate after integration.

The registry's assertions are deliberately bounded. A file-presence check establishes that its
named artifacts exist and contain bytes. It does not establish that an installation works or a
policy is appropriate. Those promises have their own rehearsal or review criteria.

## Evidence format

Keep evidence under ignored `artifacts/launch/`, especially records containing account/resource
identifiers or private review material. Publish only sanitized evidence deliberately selected for
public sharing. Raw credentials, sign-in links, cookies, private backlog content, and unredacted
secret-scanner findings do not belong in reports.

An evidence manifest has `schemaVersion: 1` and an `entries` array. A rehearsal entry has this shape:

```json
{
  "schemaVersion": 1,
  "entries": [
    {
      "criterion": "RUN-01.02",
      "kind": "rehearsal",
      "status": "passed",
      "criterionSha256": "COPY_FROM_CURRENT_LAUNCH_REPORT",
      "scopeSha256": "COPY_FROM_CURRENT_LAUNCH_REPORT",
      "performedBy": "Identity of the actual operator or evidence-producing workflow",
      "performedAt": "2026-10-31T12:00:00Z",
      "environment": "Identity of the isolated checkout, container runtime and fixture",
      "procedure": "Actual command and procedure used",
      "conclusion": "Specific assertions exercised and observed outcomes",
      "artifacts": [
        {
          "path": "artifacts/launch/local-install/report.json",
          "sha256": "SHA256_OF_THE_RETAINED_FILE"
        }
      ]
    }
  ]
}
```

The example is illustrative and cannot pass as supplied. Copy criterion and source-scope hashes
from the current launch result, execute the procedure, and record the actual observed result.
The exported `fingerprintCriterion(criterion, source)` helper in the verifier can bind evidence
generated by a maintained rehearsal tool. `collectLaunchEvidence({ root, source, registry,
verifierReceipt })` collects maintained producer receipts into a manifest; its optional
`verifierReceipt` selects an explicit retained full-verifier run. The normal launch profile uses
this collector when no manifest is supplied. Do not populate successful records merely because the
documentation or procedure exists.

Allowed external kinds are `rehearsal`, `review`, `audit`, and `verifier`, matching each criterion's declared
method. Allowed supplied outcomes are `passed`, `failed`, and `blocked`. Every entry requires a
producer, date, environment, procedure, conclusion, and retained SHA-256-bound artifacts.

The evaluator rejects unknown criterion IDs, duplicate records for one criterion, incompatible
methods, stale criterion/source hashes, missing artifacts, changed artifact bytes, and paths
outside the repository. Directory scopes include new and removed files; `.` scopes the complete
source inventory. File hashes cover source bytes, rather than a reusable approval checkbox.

Audit records identify their retained `receipt`. The evaluator requires its actual kind, outcome,
current whole-source fingerprint, pinned tool version, and required named checks. Secret audits
must cover both the current tree and full history and bind the current HEAD and reachable ref
inventory. Prose audits require the writing-rules result. A generic `passed: true` field is
insufficient. A retained blocked audit stays blocked.

The maintained local producer's evidence includes all four operation receipts (`create`,
`restart`, `rebuild`, and `reset-verified`), expected fixture data, the lifecycle log and cloned
commit identity. It is accepted only against clean committed source at that same HEAD. New source
requires a fresh rehearsal.

For `REL-01.01`, use kind `verifier` and add `receipt` with the repository-relative path to a
completed `all`-profile `report.json`. Include that receipt and every executed step's stdout and
stderr logs in `artifacts`, each with its digest. Keep logs next to their receipt using their
recorded filenames so a retained run can move between CI and local checkouts. The evaluator
requires the complete expected suite, executed/passing steps, a matching whole-source fingerprint,
and all bound logs. A doctor, build-only, failed, skipped, or stale receipt is insufficient.

The separate PR-base-aware changelog and spec-lock checks remain required under `REL-01.02`;
the full current-tree verifier does not replace them.

## Result and trust boundaries

- `passed`: the mechanical assertion succeeded or applicable evidence was accepted.
- `failed`: an assertion failed, evidence was invalid/stale, or required scoped source was missing.
- `blocked`: a live rehearsal lacks evidence or records an unmet prerequisite.
- `not-run`: required full-verifier evidence has not been supplied.
- `pending-review`: an applicable reviewer attestation has not been supplied.

Readiness requires every criterion to pass. Required criteria cannot disappear silently, and
missing or incompatible evidence never counts as success. Applicability changes need a reviewed
registry change and an explicit rationale in the PR; this version has no automatic exemption flag.

Review and external rehearsal records are attestations by their producers. Hashes detect changed
source and artifacts; they do not authenticate a producer or establish the correctness of a human
conclusion. The release maintainer reviews evidence provenance before publication. A script cannot
decide redistribution rights, editorial quality, service suitability, or prove a real mailbox flow
from mocked authentication alone.

Technical, newcomer and editorial reviews can be delegated to an AI reviewer. Identify that
reviewer explicitly in `performedBy`, label its retained assessment `reviewerType: "ai"`, and
record the inspected source, findings, resolutions and limits. This records the review actually
performed; it does not claim a human approval. Account ownership, redistribution rights, consent to
publish private organizational material, provider commitments and publication authorization still
need the responsible owner's decision. A delegated review must leave those unknown facts open.

The [review follow-up](launch/review-follow-up.md) separates those remaining decisions from
account prerequisites and final release actions. Some provider checks require a public source URL:
complete the controlled publication steps before describing the deployment button as rehearsed.

## Reused approaches

The implementation reuses the existing verifier, source fingerprints, test stack, log retention,
and documentation checks. The registry borrows requirement IDs, traceability and stale-review
tracking from [Doorstop](https://github.com/doorstop-dev/doorstop), assessment wording from the
[OpenSSF Security Baseline](https://github.com/ossf/security-baseline), and the policy/rationale
separation illustrated by [New Relic's repository rules](https://github.com/newrelic/.github/blob/main/repolinter-rulesets/community-plus.yml).
Behavioral procedures follow the concrete examples approach used by
[Cucumber](https://github.com/cucumber/cucumber-js).

Project writing rules and applicable individual security findings can come from
[Vale](https://github.com/vale-cli/vale) and [OpenSSF Scorecard](https://github.com/ossf/scorecard).
Those tools cover defined parts of the criteria. A style result or aggregate security score does
not substitute for an installation, recovery exercise, or review.
