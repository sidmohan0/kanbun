# HTTP API Reference

Base URL: `http://localhost:7890`

## Projects
- `GET /api/projects`
- `POST /api/projects` `{ name, description? }`
- `GET /api/projects/:id`
- `PATCH /api/projects/:id/stages` `{ stages: string[] }`
- `PATCH /api/projects/:id/cadence` `{ cadence: number[] }`
- `PATCH /api/projects/:id/account` `{ account_id: number }`

## Contacts
- `GET /api/contacts?project_id=&stage=`
- `GET /api/contacts/:id`
- `POST /api/contacts` `{ first_name, last_name, email, company?, title?, source? }`
- `POST /api/contacts/import` `{ rows: Array<CSVRow>, project_id?, stage? }`
- `POST /api/contacts/:id/assign` `{ project_id, stage }`
- `PATCH /api/contacts/:id/stage` `{ project_id, stage }`

## Drafts
- `GET /api/drafts?status=&project_id=`
- `GET /api/drafts/:id`
- `POST /api/drafts` `{ project_id, contact_id, send_account_id, subject, body, draft_type }`
- `PATCH /api/drafts/:id` `{ subject, body }`
- `PATCH /api/drafts/:id/status` `{ status }`
- `POST /api/drafts/:id/send`

> `/api/drafts/generate` is not implemented yet.

## Templates
- `GET /api/templates?project_id=`
- `GET /api/templates/:id`
- `POST /api/templates` `{ project_id, name, subject, body, variables }`
- `POST /api/templates/:id/render` `{ vars }`

## Accounts
- `GET /api/accounts`
- `GET /api/accounts/:id`
- `POST /api/accounts` `{ provider, email_address, display_name, credentials }`
