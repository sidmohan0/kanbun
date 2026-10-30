# Team dogfooding readiness

This checklist covers the product and operational work needed before an invited team pilot.
Loading a real backlog and running the pilot are separate, later decisions. Existing CI, the
devcontainer verifier, changelog policy, and automated preview deployment remain required gates.

1. [x] Issue details and descriptions: shareable issue URLs; durable Yjs descriptions; concurrent
       edits and offline/reload recovery converge without losing either person's work.
       [Implementation](ux/issue-details.md); [browser proof](../packages/verifier/test/recovery/app-document.spec.ts)
       and [authenticated document proof](../packages/verifier/test/recovery/app-document-preview.spec.ts).
2. [x] Core issue controls: status, assignee, priority, labels, and archive; validated semantic
       events and deterministic replay for the supported changes.
       [Implementation](ux/issue-properties.md); [browser proof](../packages/verifier/test/recovery/app-controls.spec.ts)
       and [replay proof](../packages/mutators/test/events.test.ts).
3. [x] Team access: individual identities, owner-managed invitations and revocation, workspace
       roles, and clear membership administration. No shared identity or public admission.
       [Implementation](ux/workspace-members.md); [browser proof](../packages/verifier/test/recovery/app-membership.spec.ts)
       and [HTTP proof](../apps/worker/test/membership.test.ts).
4. [x] Authorization proof: correct attribution; removed-member denial; private-team and
       cross-workspace isolation through the actual HTTP, document, and WebSocket entry points.
       [Authority contract](hosted-preview.md); [membership proof](../apps/worker/test/membership.test.ts)
       and [current-issue history proof](../apps/worker/test/discussion.test.ts).
5. [x] Discussion and history: persistent comments and an attributed activity feed, including
       description and issue-control changes.
       [Implementation](ux/issue-discussion.md); [browser proof](../packages/verifier/test/recovery/app-discussion.spec.ts).
6. [x] Daily views: My Issues, search, filters, and sorting for status, assignee, priority, and label.
       [Implementation and measurements](ux/issue-views.md); [browser proof](../packages/verifier/test/recovery/app-views.spec.ts).
7. [x] In-app notifications: assignments, mentions, and replies with per-user read state and links
       to the relevant issue. External email and chat delivery are outside this milestone.
       [Implementation](ux/workspace-inbox.md); [browser proof](../packages/verifier/test/recovery/app-inbox.spec.ts)
       and [consumer/recovery proof](../apps/worker/test/notifications.test.ts).
8. [x] Data recovery: restorable workspace and document backups, with a successful isolated
       restoration exercise. Code rollback is not evidence of data recovery.
       [Implementation and recovery procedure](data-recovery.md); [isolated restore proof](../apps/worker/test/backups.test.ts).
9. [x] Operations: availability checks, actionable error reporting without private issue contents
       or credentials, and an operator recovery runbook.
       [Runbook](operations.md); [health-check proof](../scripts/preview-health.test.mjs),
       [error-reporting proof](../apps/worker/test/reporting.test.ts), and
       [successful hosted health run](https://github.com/sidmohan0/kanbun/actions/runs/41124994715).
10. [x] Team-scale acceptance: multiple authenticated users; concurrent and offline editing;
        expired/revoked sessions; realistic issue volume; measured 5,000-issue bootstrap and rendering
        against the specification's one-second target.
        [Scale fixture](../packages/verifier/test/recovery/app-scale.spec.ts),
        [authenticated recovery](../packages/verifier/test/recovery/app-membership.spec.ts), and
        [measurement definition](ux/issue-views.md#measured-rendering-evidence).

## Recorded qualification

On October 30, 2026, the
[qualification source](https://github.com/sidmohan0/kanbun/commit/57192165e600c5864f25bd23e58ba4ea6573a1f1)
passed all 15 devcontainer verifier steps, including 37 Chromium cases and 53 Worker package cases.
The full-suite 5,000-issue observation was 815.5 ms from bootstrap fetch to painted React view; a
controlled single-worker observation was 724.0 ms, including 62.8 ms HTTP and a 420,126-byte encoded
response. Both rendered all 5,000 rows with initially empty browser storage and met the one-second
target. Fixture seeding and cold module compilation are excluded. These local observations are
retained acceptance evidence rather than a hosted latency guarantee; CI retains fresh receipts and
browser reports for each candidate.

Implementation proceeds in focused PRs. Frontend, backend, and behavioral tests can run in parallel
within a slice once their interfaces agree. Access administration precedes hosted multi-user proof;
semantic issue controls precede activity and notification consumers. Backups and monitoring can
proceed independently once the document storage contract is settled.

Each completed item must link to its implementation and verification evidence. A checked box
describes proven behavior, rather than a planned feature or an unexecuted test.
