# Launch review follow-up

Technical and editorial review findings were resolved on the public-launch branch.
Retained assessments identify their AI reviewers and inspected source; the source-bound launch
report records which acceptance criteria have applicable evidence. These reviews do not establish
the owner's rights to publish organizational material or create provider accounts.

## Authorized launch work

The repository owner has authorized public source publication and a live installation using
isolated resources in the existing Cloudflare account. That authorization covers the technical
publication and resource-isolation work. Actual credential entry and provider consent remain with
the account owner. Receipts identify which authorized actions have actually completed.

The maintainer's stated intention to receive paid setup inquiries supplies the service-offer
authorization. Deliverables, feasibility, pricing, access and availability are agreed per
engagement; the reviewed offer promises no standing price, response time or guaranteed acceptance.

## Account prerequisites for the live exercises

Read-only checks on 2026-10-31 found signed-in GitHub, Cloudflare and Resend browser sessions.
GitHub reports repository administrator access. Cloudflare exposes one account containing the
maintainer installation, and Resend shows a verified `auth.kanbun.ai` sender domain. Mail exposes
the `sid@datafog.ai` receiving inbox with recent delivered Kanbun mail, establishing an operational
private contact route. No test message was sent. Those existing deployment resources are not an
independent installer rehearsal and their secrets were not retrieved.

| Prerequisite                     | Criteria  | Minimum access or input                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Isolated Cloudflare installation | RUN-02.01 | The authorized existing account with Workers, SQLite Durable Objects, D1 and R2 available, and dedicated Worker/namespace, D1, R2 and workspace identities for this rehearsal. Use its assigned `workers.dev` hostname to avoid requiring a new application domain.                                                        |
| Real sign-in and membership      | RUN-02.01 | A verified Resend sender and scoped sending key; a managed Turnstile widget and server secret for the new hostname; an owner address and a second eligible address in the configured email domain, with access to both receiving mailboxes. Existing sender access can be reused only with its owner's authorization.      |
| Optional GitHub integration      | RUN-02.02 | Authority to register and install a separate GitHub App for the new origin; a disposable selected repository and PR; the documented read permissions and event subscriptions. The native owner must approve the OAuth/installation grants. Configure generated credentials directly in the isolated Worker's secret store. |

Enter secret values through the provider UI or the documented local secret commands. Do not put
them in chat, Git, screenshots, review notes or retained deployment output. Account creation,
billing acceptance and new sensitive access grants require the account owner's participation.

## Controlled completion order

1. Publish the authorized source after reviewing the publication inventory and qualified PR.
   Retain the actual visibility change and merged source identity; report any concrete rights or
   privacy findings before including affected material.
2. Make the approved candidate source available at the chosen public URL. Cloudflare's
   [official button requires a public repository](https://developers.cloudflare.com/workers/platform/deploy-buttons/).
   A separately approved public rehearsal copy can establish provider behavior before the main
   repository is announced; it must contain the same qualified source and use its own button URL.
3. Run the isolated Cloudflare procedure with synthetic data in the authorized existing account. Retain provisioning, migration,
   real owner/member sign-in, removal, redeployment/retry, issue persistence and isolated restore
   observations. Record failures and fix them before claiming that path works.
4. Run the separate GitHub App connection, selected-repository link, signed observation,
   revocation and reconnection exercise. Retain sanitized outcomes without provider credentials
   or private repository content.
5. Verify the declared private reporting route and recheck required branch checks on the public
   repository. GitHub's optional built-in
   [private vulnerability reporting is available for public repositories](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).
   The email route remains the policy's declared reporting channel.
6. Requalify any repaired source, run the separate history-aware checks, bind all review and live
   evidence to the final candidate, and publish the reviewed tag and release notes. Verify the
   remote tag resolves to that exact source before announcing the release.

The final account steps are distinct from implementation work. No repository visibility, provider
configuration, App grants, mail delivery, release tags or production data are changed by generating
the launch report.
