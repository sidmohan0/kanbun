# Workspace data backups and isolated recovery

The protected preview stores recovery bundles in the private `kanbun-preview-backups` R2 bucket.
Its `BACKUPS` binding is available only to the Worker. Keep R2 public access disabled and keep
account credentials, backup contents, and invitation/session data out of logs and public artifacts.
The default local Worker has no remote backup binding; runtime tests use independent local buckets.

## What a bundle preserves

A bundle includes the dedicated D1 directory, the configured workspace's complete application SQL
schema and tables, and the Yjs bodies of its current issue incarnations. SQL includes projections,
events, sync patches, client mutation acknowledgements, branches and overlays, migrations,
scheduled jobs, and SQLite sequence high-watermarks. Binary cells retain their bytes. Additional
workspaces require their own workspace bundles.

The archive records schema hashes, each part's SHA-256, source semantic and patch sequences,
creation time, and deployed Worker version/source commit from the version metadata binding.
Local fixtures can have no deployment metadata. Recovery from a deployed archive requires its
source commit and an identical migrated schema. The importer compares that schema against the
running code; it never executes SQL supplied by an archive.

The WorkspaceDO takes its SQL snapshot transactionally and the D1 directory in an atomic batch.
It reads every issue's current DocumentDO without initializing unused bodies. A durable body must
match the corresponding SQL mirror and content hash, including after an interrupted publication.
The complete SQL and directory fingerprints are checked again before publishing the manifest.
A changed source or unpublished body fails the attempt. Requests continue normally while capture
is in progress; sustained writes can postpone a successful backup.

Parts are created conditionally under a unique prefix. The immutable manifest is written last.
Partial uploads have no complete manifest and cannot be restored. A successful publication adds a
system `SnapshotTaken` fact with its manifest key, source sequence, and hash; it creates no issue
patch. The archive represents the source point before this audit fact. Existing bundles are kept;
this implementation introduces no automatic retention deletion.

## Automatic schedule and rollout

The workspace's `scheduled_job` table contains one deduplicated `workspace-backup` job. Its Durable
Object alarm attempts an initial backup, then another after one week or 10,000 main semantic
sequence positions, whichever comes first. The payload records the latest successful archive point
and manifest key; `fire_at` records the next weekly deadline. The alarm handler owns retries through
Cloudflare's platform behavior. Failed captures leave the previous successful bundle intact and
emit a content-free `workspace_backup_failed` error.

Create the dedicated private bucket before deploying the binding:

```sh
./scripts/devcontainer.sh exec pnpm --filter @kanbun/worker exec wrangler r2 bucket create kanbun-preview-backups
```

Verify private bucket access in the Cloudflare dashboard. Adding or changing this storage binding
requires a separate compatible deployment rollout; automatic code rollback cannot cross it.
The production deployment guard rejects recovery-mode variables. Keep ordinary JWT verification,
the Access application, and disabled alternative preview URLs in place.

## Isolated restore procedure

1. Select a complete manifest and retain its exact parts. Start from its recorded source commit,
   using the devcontainer and the same migration bundle. Preserve the original bundle unchanged.
2. Create an independent local test harness or isolated Worker namespace, D1 database, and document
   namespace. Apply migrations only. Give it the same canonical workspace ID, with no production
   route or public URL. Set `BACKUP_RESTORE_ISOLATED=true` only in that recovery configuration.
   For a local recovery of a tagged archive, set `BACKUP_RESTORE_SOURCE_COMMIT` to the checked-out
   source commit; a deployed recovery Worker can supply the matching version tag instead.
3. Make the selected private bundle available through that target's R2 binding. Invoke the
   WorkspaceDO's private `restoreBackup(workspaceId, manifestKey)` RPC through the isolated
   harness/service binding. There is no HTTP restore endpoint. Normal JWT authentication remains
   enabled for subsequent verification. HTTP requests cannot initialize directory membership or
   open workspace data until restoration is complete.
4. The importer validates all parts and bodies before writes and refuses used SQL or directory
   targets. Each document is restored through one private RPC that atomically checks its target is
   empty, persists the body, and acknowledges its content hash. D1 emptiness is checked again in
   its import transaction. A used document or interrupted import
   leaves the isolated workspace unavailable. Discard that target and start with a fresh namespace;
   recovery never clears or overwrites an existing target.
   Concurrent restore attempts claim the target atomically after read-only validation; only the
   winner begins import. A rejected archive that fails preflight leaves the target unclaimed.
5. Verify authenticated context, issue and description reads, branch contents, and mutation retries.
   Review membership removals and credential/invitation changes since the archive point before any
   separately reviewed production cutover. Preserve fresh production writes during that decision.

The real-runtime restoration exercise uses synthetic data and independent `workerd` namespaces:

```sh
./scripts/devcontainer.sh exec pnpm --filter @kanbun/worker exec vitest run test/backups.test.ts
```

It checks every captured SQL table, the D1 identity binding, collaborative body, open branch, retry
cursor, corruption and nonempty-target rejection, and durable-but-unpublished body handling.
Production data is never imported by the test.

## Additional point-in-time recovery tools

[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) is always enabled.
Its recovery window is 30 days on Workers Paid and 7 days on Workers Free. Inspect bookmarks with
`wrangler d1 time-travel info` before planning recovery. An in-place Time Travel restore overwrites
that database and is a separately reviewed operational action.

[SQLite Durable Object PITR](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api)
retains bookmarks for the previous 30 days, including SQL and key-value data. Its restore takes
effect after the object's next restart and is unavailable in local development. Independent D1
and Durable Object bookmarks do not establish a coherent cross-store snapshot; use the validated
bundle when restoring the directory, workspace, and document bodies together.
