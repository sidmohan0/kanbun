# Evaluate Kanbun for your team

Kanbun currently serves an invited engineering team that wants to own its Cloudflare deployment.
Evaluate it with synthetic data before loading a real backlog. Use the
[local guide](local-worker.md) for product exploration and the
[Cloudflare guide](cloudflare-deployment.md) for authenticated deployment.

## Developer walkthrough

1. Initialize the local workspace and create an issue.
2. Change its status, priority, labels, and assignee. Open the description and add text.
3. Open a second browser context and confirm that issue changes appear automatically.
4. Use the board, My Issues, search, and combined filters to find the same work.
5. While an initialized page is open, disconnect its network, edit, reconnect, and check the saved
   state. Hosted reloads require connectivity and authentication before reopening cached data.
6. Review [architecture](architecture.md), [verification](verification.md), and the supported
   [branch API](workspace-branches.md) before extending the engine.

## Team and operator walkthrough

Deploy an isolated installation, sign in as its owner, invite an eligible teammate, and confirm
that both people can collaborate. Create team/status configuration and review membership removal.
If using GitHub, register your App, authorize selected repositories, map one to a team, and link a
pull request. Check that repository and issue access match your intended audience.

Before adoption, run the [operating checklist](operations-overview.md), including an isolated
backup restoration. Record the selected source commit, provider configuration, and responsible
operator. The [launch-readiness process](launch-readiness.md) records which claims have passing
evidence and which still need review or a live rehearsal.

## Fit and current limits

The application supports issue work, collaborative descriptions, discussion, and GitHub context.
Agent execution and branch-review UI are planned. Projects, cycles, broader planning views,
external notifications, general-purpose import/export, and complete event-based reconstruction
are outside the currently documented product scope. Check the current
[README capability table](../README.md#current-boundaries) and release notes.

The existing data path is a Kanbun recovery bundle containing directory, SQL, and document state.
It requires compatible Kanbun code and isolated storage for restoration. The bundle is an
operational recovery format. A portable backlog export or import from another tracker requires
separately implemented and verified tooling. Confirm your migration and exit requirements before
adoption.

## Discuss a setup engagement

Engineering managers can use the [implementation-help scope](../SUPPORT.md#paid-implementation-help)
to identify desired deliverables, account/domain access, integrations, data migration, and ongoing
operating responsibilities. Send [sid@datafog.ai](mailto:sid@datafog.ai) your team size, current
tools, and setup requirements.
