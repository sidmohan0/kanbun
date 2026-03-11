# Contributing

Kanbun is documentation-first and agent-friendly. Changes should preserve that shape.

## Before You Change Code

1. Read the relevant ADRs in [docs/adr/README.md](./docs/adr/README.md).
2. Read the matching product spec in [docs/product/README.md](./docs/product/README.md).
3. If behavior is changing materially, update the docs alongside the code.

## Local Development

```bash
pnpm install
cp .env.example .env.local
pnpm db:up
pnpm db:migrate
pnpm dev
pnpm worker
```

Open `http://localhost:7890`.

For normal local development, you can set `OWNER_MODE_ENABLED=false` to bypass sign-in. To test the real auth path, set `OWNER_MODE_ENABLED=true` and sign in at `/signin`.

## Contribution Standards

- Keep changes small and coherent.
- Prefer vertical slices over isolated infrastructure work.
- Preserve the canonical contact model instead of adding parallel source-specific behavior.
- Treat provider integrations as unreliable boundaries: classify failures, retain operator visibility, and prefer resumable flows.
- Update tests when changing operator-visible behavior.

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm worker:once
```

If you change React UI, run:

```bash
npx -y react-doctor@latest . --verbose --diff
```

## Pull Requests

- Explain the operator-facing change.
- Call out env, migration, or OAuth callback impacts explicitly.
- Note any follow-up work that remains intentionally out of scope.

## Integration Notes

- Google sign-in is owner auth.
- Gmail and Microsoft connected accounts are provider integrations, not the auth session itself.
- Todoist is configured via `TODOIST_API_TOKEN`.
- Public HTTPS is required for webhook-based provider flows; local development falls back to polling.
