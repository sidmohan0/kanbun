# CLI Reference

> The server must be running (`npm run dev`) before using the CLI.

Run via:
```bash
npm run cli -- <command>
```

## Projects
```bash
npm run cli -- project create "Series A Raise"
npm run cli -- project list
npm run cli -- project set-stages <id> "Researched,Drafted,Sent"
npm run cli -- project set-cadence <id> 3,7,14
npm run cli -- project set-account <id> <account-id>
```

## Contacts
```bash
npm run cli -- contact add --name "Jane Doe" --email jane@acme.com --company Acme
npm run cli -- contact import --csv ./leads.csv --project 1 --stage Researched
npm run cli -- contact list --project 1 --stage Researched
npm run cli -- contact move <contact-id> --project 1 --stage Sent
```

## Drafts
```bash
npm run cli -- draft list --status pending_review
npm run cli -- draft preview <id>
```

### Draft generation (pending server support)
The CLI currently calls `/api/drafts/generate`, but that endpoint is not implemented yet.

## Templates
```bash
npm run cli -- template create --project 1 --name "Cold Intro" --subject "Hi {{firstName}}" --body "..." --vars firstName,company
npm run cli -- template list --project 1
```

## Email accounts
```bash
npm run cli -- account list
```

> `account add` is stubbed; OAuth flow is not wired yet.
