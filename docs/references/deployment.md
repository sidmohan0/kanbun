# Deployment Reference

This document describes the minimum production shape for Kanbun.

## Runtime Topology

Run Kanbun as two processes:

- `web`: Next.js application server
- `worker`: background worker for imports, provider sync, sequences, outbound send, Todoist reconciliation, and webhook-triggered follow-up work

Both processes must point at the same PostgreSQL database and the same environment configuration.

## Required Environment

Core:

- `KANBUN_URL`
- `KANBUN_PORT`
- `DATABASE_URL`
- `APP_ENCRYPTION_KEY`
- `OWNER_MODE_ENABLED=true`

Owner auth:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Optional providers:

- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_TENANT_ID`
- `TODOIST_API_TOKEN`

Webhook mode:

- `GOOGLE_GMAIL_PUSH_TOPIC`
- `GOOGLE_GMAIL_WEBHOOK_TOKEN`
- `MICROSOFT_WEBHOOK_CLIENT_STATE`

## Production Expectations

- `KANBUN_URL` must be a public HTTPS URL.
- The worker must be supervised separately from the web process.
- Database backups must exist before running schema migrations in production.
- OAuth redirect URIs must exactly match the deployed `KANBUN_URL`.
- Webhook endpoints must be reachable by Google and Microsoft.

## Deployment Checklist

1. Provision PostgreSQL.
2. Set application secrets and provider credentials.
3. Deploy `web`.
4. Deploy `worker`.
5. Run `pnpm db:migrate`.
6. Verify `/signin` works with Google owner auth.
7. Verify Google and Microsoft callbacks.
8. Verify worker health with `pnpm worker:once` equivalent in the deployed environment.
9. Verify outbound send is paused until at least one provider account is connected with current scopes.

## Health Checks

Web:

- HTTP response on `/signin`
- HTTP response on `/settings`

Worker:

- recent worker log activity
- no growing backlog of queued imports, outbound sends, or provider sync requests
- no repeated reconnect-required loops without operator visibility

## Operational Notes

- Local bypass auth is for development only.
- Google contact sync remains incremental pull-based.
- Gmail reply tracking can use push plus polling fallback.
- Microsoft contact and reply sync can use Graph subscriptions plus polling fallback.
