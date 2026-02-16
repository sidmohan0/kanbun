# Setup

## Requirements
- Node.js 20+
- npm

## Install
```bash
npm install
```

## Build UI bundle
The server serves the built UI from `dist/ui`. Build it with:
```bash
npx vite build
```

## Run the server
```bash
npm run dev
```
The server runs on `http://localhost:7890` by default.

## Run the Electron shell
In a separate terminal (server must already be running):
```bash
npm run electron
```

## Environment variables
- `KANBUN_PORT` — server port (default: `7890`)
- `KANBUN_URL` — base URL for CLI requests (default: `http://localhost:7890`)

## Data storage
SQLite DB is stored at:
```
./data/kanbun.db
```

## Integrations (status)
- Gmail/Outlook services exist, but OAuth flows aren’t wired into the CLI yet.
- Apollo MCP integration is stubbed.
