# Claude Code Instructions for Kanbun

## Data Safety Rules (CRITICAL)

1. **NEVER** overwrite, delete, move, or modify `data/kanbun.db` without explicit user permission
2. **NEVER** run `cp`, `mv`, or `rm` commands on any `.db` file without asking first
3. **ALWAYS** create a backup before any destructive file operation on user data
4. **ASK** before any operation that could result in data loss

The file `data/kanbun.db` contains production data. Treat it as irreplaceable.

## Safe Operations

- `data/demo.db` - Safe to overwrite/recreate (demo data only)
- `data/kanbun.db` - PROTECTED, never modify without permission

## When Working with Databases

If you need to test database changes:
1. Use demo mode toggle in the app (switches to demo.db)
2. Or create a separate test database with a new name
3. NEVER copy over kanbun.db

## Project Context

- This is a personal CRM and lead enrichment tool
- The production database contains real contacts and company data that took time to collect and enrich
