# Security policy

## Report a vulnerability privately

Email [sid@datafog.ai](mailto:sid@datafog.ai) with the subject **Kanbun security report**.
Use this route for suspected authentication or authorization bypasses, exposed credentials,
private workspace data, and other security vulnerabilities.

Include the affected commit or release, deployment mode, reproduction steps, expected behavior,
and potential impact. Use synthetic data and redact credentials, sign-in links, invitation tokens,
backups, and private issue content. Ask for a secure transfer method before sharing sensitive
reproduction material.

Keep vulnerability details out of public issues and pull requests while the report is being
assessed. The maintainer will coordinate remediation and disclosure with the reporter. Response
and remediation times depend on the report and maintainer availability.

## Supported versions

Kanbun is in active development. Security fixes are developed against the current `main` branch.
Installations should identify their exact source commit and review updates before deploying them.
There is currently no long-term support branch or published backport commitment. A release's notes
will identify any additional support commitment specific to that release.

## Deployment responsibilities

Operators control their Cloudflare account, email provider, domain, GitHub App, deployment
credentials, and data access. Keep secrets outside Git, keep backup buckets private, rotate
credentials after suspected exposure, and follow the
[operating guide](docs/operations-overview.md). Local fixture identities are intended for
localhost development and evaluation with synthetic data.
