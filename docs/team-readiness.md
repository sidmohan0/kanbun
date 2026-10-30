# Team dogfooding readiness

This checklist covers the product and operational work needed before an invited team pilot.
Loading a real backlog and running the pilot are separate, later decisions. Existing CI, the
devcontainer verifier, changelog policy, and automated preview deployment remain required gates.

1. [ ] Issue details and descriptions: shareable issue URLs; durable Yjs descriptions; concurrent
       edits and offline/reload recovery converge without losing either person's work.
2. [ ] Core issue controls: status, assignee, priority, labels, and archive; validated semantic
       events and deterministic replay for the supported changes.
3. [ ] Team access: individual identities, owner-managed invitations and revocation, workspace
       roles, and clear membership administration. No shared identity or public admission.
4. [ ] Authorization proof: correct attribution; removed-member denial; private-team and
       cross-workspace isolation through the actual HTTP, document, and WebSocket entry points.
5. [ ] Discussion and history: persistent comments and an attributed activity feed, including
       description and issue-control changes.
6. [ ] Daily views: My Issues, search, filters, and sorting for status, assignee, priority, and label.
7. [ ] In-app notifications: assignments, mentions, and replies with per-user read state and links
       to the relevant issue. External email and chat delivery are outside this milestone.
8. [ ] Data recovery: restorable workspace and document backups, with a successful isolated
       restoration exercise. Code rollback is not evidence of data recovery.
9. [ ] Operations: availability checks, actionable error reporting without private issue contents
       or credentials, and an operator recovery runbook.
10. [ ] Team-scale acceptance: multiple authenticated users; concurrent and offline editing;
        expired/revoked sessions; realistic issue volume; measured 5,000-issue bootstrap and rendering
        against the specification's one-second target.

Implementation proceeds in focused PRs. Frontend, backend, and behavioral tests can run in parallel
within a slice once their interfaces agree. Access administration precedes hosted multi-user proof;
semantic issue controls precede activity and notification consumers. Backups and monitoring can
proceed independently once the document storage contract is settled.

Each completed item must link to its implementation and verification evidence. A checked box
describes proven behavior, rather than a planned feature or an unexecuted test.
