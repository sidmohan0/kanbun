# AGENTS.md

This repository is being built for agent-assisted engineering from the start.

Keep this file short. Treat it as a map, not the full manual.

## Start here

- Read [docs/README.md](./docs/README.md) for the documentation map.
- Read [docs/adr/0001-foundation.md](./docs/adr/0001-foundation.md) before making architecture decisions.
- Update ADRs and docs when changing system boundaries, provider strategy, data ownership, or repository workflow.

## Working principles

- Repository-local documentation is the system of record.
- Prefer stable, boring, well-documented technologies that agents can reason about reliably.
- Keep changes small and explicit; capture important decisions in versioned markdown.
- Favor mechanical guardrails over tribal knowledge.
- Do not hide important product or architecture context in chat threads or external docs without also encoding it here.

## Documentation layout

- [docs/adr/](./docs/adr/README.md): architectural decision records
- `docs/plans/`: active and completed execution plans
- `docs/product/`: product definitions, scope, and user workflows
- `docs/references/`: provider notes, external API constraints, and operational references

## Near-term expectations

- Application bootstrap should follow the ADR set and product docs rather than inventing behavior ad hoc.
- Changes to workflow behavior should update `docs/product/` alongside code.
