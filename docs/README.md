# Documentation Map

The repository documentation is the source of truth for product intent, architecture, and agent operating rules.

## Structure

- [adr/](./adr/README.md): accepted and proposed architecture decisions
- [plans/](./plans/README.md): execution plans and progress logs
- `product/`: product specs, user journeys, and operating assumptions
- `references/`: external API notes, provider constraints, and deployment references

## Current focus

The project is in pre-code planning with two completed documentation layers:

- architecture decisions in the [ADR index](./adr/README.md)
- first-phase workflow specs in the [product docs](./product/README.md)

Recommended reading order:

1. [ADR-0001: Foundation for Kanbun](./adr/0001-foundation.md)
2. [ADR-0002: Auth, Connected Accounts, and Secret Management](./adr/0002-auth-connected-accounts-and-secrets.md)
3. [Product docs index](./product/README.md)
4. [Frontend Foundation Spec](./product/frontend-foundation-spec.md)
5. [Initial Bootstrap and First Vertical Slice](./plans/0001-initial-bootstrap-and-first-vertical-slice.md)

## Documentation rules

- Architecture changes require ADR updates.
- New subsystems should be introduced with a doc before or alongside implementation.
- Prefer short entry-point docs that link to deeper references instead of one large instruction file.
