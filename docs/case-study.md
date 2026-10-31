# Kanbun engineering case study

Kanbun is an issue tracker built by [Sid Mohan](https://sidmohan.com) to explore durable,
collaborative work management on Cloudflare. The repository contains the application, sync engine,
data model, operating procedures, and verification tooling. Git history records the source changes
and contributors.

## Engineering decisions

| Decision                                              | Purpose                                                                    | Tradeoff                                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| One SQLite Durable Object per workspace               | Serialize writes and assign authoritative ordering within a workspace      | Workspaces depend on Cloudflare's runtime and each workspace's writer capacity.                          |
| Optimistic commands with persisted browser queues     | Keep edits responsive and retain pending work through browser reloads      | Reconciliation, retry identity, and storage failure become product behavior that needs explicit testing. |
| Yjs descriptions in separate Document Durable Objects | Merge concurrent rich-text edits and isolate document traffic              | SQL mirrors and document bodies need a coherent backup and publication protocol.                         |
| Shared decisions and reducers for migrated commands   | Apply the same domain rules across optimistic state, authority, and replay | Incremental migration leaves a documented legacy path for unsupported event reconstruction.              |
| Versioned workspace overlays                          | Isolate proposed issue changes and retain durable merge receipts           | The supported branch command set is narrower than the full application; review UI remains planned.       |
| A shared devcontainer and verifier                    | Keep local and CI toolchains aligned and retain execution evidence         | Docker startup and browser-runtime setup add development cost.                                           |

## Inspect the behavior

- [Browser convergence and lost-acknowledgement recovery](../packages/verifier/test/recovery/app.spec.ts)
- [Concurrent and offline descriptions](../packages/verifier/test/recovery/app-document.spec.ts)
- [Identity changes, invitations, and revoked access](../packages/verifier/test/recovery/app-membership.spec.ts)
- [Durable branch merge recovery](../packages/verifier/test/recovery/branch-merge.spec.ts)
- [Coherent backup and isolated restoration](../apps/worker/test/backups.test.ts)
- [Semantic replay and authorization tests](../packages/mutators/test/events.test.ts)

These files describe reproducible scenarios. Passing evidence for a candidate comes from its
verifier receipts and CI artifacts. Local workerd scenarios establish the tested runtime behavior;
a separate hosted rehearsal establishes real account, domain, and email-provider setup.

## Measurements and limits

The [rendering evidence](ux/issue-views.md#measured-rendering-evidence) documents a synthetic
5,000-issue workload, the fetch-to-paint boundary, excluded setup time, and both passing local
observations and a slower Actions observation. Those measurements describe their recorded source
and environment. Fresh candidate reports retain their own toolchain and source identity.

The work surfaced several operating constraints: local persistence and hosted identity have
different cold-start requirements; code rollback preserves databases; restoring SQL without
matching document bodies is insufficient; and test evidence must describe the boundary it actually
exercised. These constraints are reflected in the
[operating guide](operations-overview.md) and [verification documentation](verification.md).

The [evaluation walkthrough](evaluation.md) provides a synthetic-data product tour. Setup and
engineering inquiries can be sent to [sid@datafog.ai](mailto:sid@datafog.ai).
