import { issueIncarnation } from "@kanbun/sync";
import type { SqlDriver } from "@kanbun/sync/server";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { documentName } from "./document-identity";
import {
  captureDirectory,
  captureSqlite,
  restoreDirectory,
  restoreSqlite,
  validateRestore,
  type DatabaseSnapshot,
} from "./backup-sql";
import {
  loadBackup,
  publishBackup,
  sha256,
  type BackupBundle,
  type BodyBackup,
  type StoredDocumentBackup,
} from "./backup-format";

export const BACKUP_INTERVAL = 7 * 24 * 60 * 60 * 1000;
export const BACKUP_EVENT_INTERVAL = 10_000;
export const BACKUP_JOB = "workspace-backup";
export type BackupEnvironment = {
  ACCOUNTS?: D1Database;
  BACKUPS?: R2Bucket;
  DOCUMENTS: {
    getByName(name: string): {
      snapshot(workspaceId: string, issueId: string, incarnation: string): Promise<StoredDocumentBackup | null>;
      restoreSnapshot(
        workspaceId: string,
        issueId: string,
        incarnation: string,
        value: StoredDocumentBackup,
      ): Promise<string>;
    };
  };
  BACKUP_RESTORE_ISOLATED?: string;
  BACKUP_RESTORE_SOURCE_COMMIT?: string;
  CF_VERSION_METADATA?: { id: string; tag: string; timestamp: string };
};

export function tableRows(snapshot: DatabaseSnapshot, name: string): Record<string, unknown>[] {
  const table = snapshot.tables.find((entry) => entry.name === name);
  if (!table) throw new Error("Backup is missing a required table");
  return table.rows.map((row) => Object.fromEntries(table.columns.map((column, index) => [column, row[index]])));
}
export function snapshotSequences(snapshot: DatabaseSnapshot) {
  const maximum = (table: string) =>
    tableRows(snapshot, table)
      .filter((row) => row["branch_id"] === "main")
      .reduce((seq, row) => Math.max(seq, Number(row["seq"])), 0);
  return { mainSeq: maximum("sync_log"), eventSeq: maximum("event_log") };
}
function issueIdentity(issue: Record<string, unknown>) {
  return issueIncarnation({ createdSeq: Number(issue["created_seq"]), createdAt: String(issue["created_at"]) });
}
function requireLinkage(workspaceId: string, workspace: DatabaseSnapshot, directory: DatabaseSnapshot) {
  const organizations = tableRows(workspace, "organization");
  if (organizations.length !== 1 || organizations[0]!["id"] !== workspaceId)
    throw new Error("Backup workspace identity is unavailable");
  if (!tableRows(directory, "workspaces").some((row) => row["id"] === workspaceId))
    throw new Error("Backup directory does not contain the workspace");
}
function validateBodies(workspace: DatabaseSnapshot, documents: BodyBackup[]) {
  const issues = tableRows(workspace, "issue");
  const metadata = tableRows(workspace, "document_content");
  const issueById = new Map(issues.map((issue) => [String(issue["id"]), issue]));
  const contentById = new Map(metadata.map((content) => [String(content["id"]), content]));
  const seen = new Set<string>();
  for (const body of documents) {
    if (seen.has(body.issueId)) throw new Error("Duplicate backup document");
    seen.add(body.issueId);
    const issue = issueById.get(body.issueId);
    const contentId = issue?.["description_content_id"];
    const content = typeof contentId === "string" ? contentById.get(contentId) : undefined;
    if (
      !issue ||
      issueIdentity(issue) !== body.incarnation ||
      issue["description"] !== body.state.mirror ||
      !content ||
      content["issue_id"] !== body.issueId ||
      content["content"] !== body.state.mirror ||
      content["content_state"] !== body.state.contentState
    )
      throw new Error("Document body and workspace mirror are inconsistent");
  }
  for (const issue of issues) {
    const contentId = issue["description_content_id"];
    const content = typeof contentId === "string" ? contentById.get(contentId) : undefined;
    if (issue["description_content_id"] !== null && !content) throw new Error("Description metadata is missing");
    if (content?.["content_state"] && !seen.has(String(issue["id"]))) throw new Error("Document body is missing");
  }
}

export async function createBackup(
  driver: SqlDriver,
  env: BackupEnvironment,
  workspaceId: string,
): Promise<{ key: string; manifestHash: string; eventSeq: number; mainSeq: number }> {
  if (!env.ACCOUNTS || !env.BACKUPS) throw new Error("Private backup storage is not configured");
  const directory = await captureDirectory(env.ACCOUNTS);
  const workspace = captureSqlite(driver);
  requireLinkage(workspaceId, workspace, directory);
  const sequences = snapshotSequences(workspace);
  const workspaceHash = await sha256(JSON.stringify(workspace));
  const directoryHash = await sha256(JSON.stringify(directory));
  const documents: BodyBackup[] = [];
  // Inspect every incarnation, including a first body whose mirror publication failed.
  for (const issue of tableRows(workspace, "issue")) {
    const issueId = String(issue["id"]),
      incarnation = issueIdentity(issue);
    const state = await env.DOCUMENTS.getByName(documentName(workspaceId, issueId, incarnation)).snapshot(
      workspaceId,
      issueId,
      incarnation,
    );
    if (state) documents.push({ issueId, incarnation, state });
  }
  validateBodies(workspace, documents);
  const publication = await publishBackup(
    env.BACKUPS,
    {
      workspace,
      directory,
      documents,
      manifest: {
        format: 1,
        workspaceId,
        createdAt: new Date().toISOString(),
        ...sequences,
        workerVersion: env.CF_VERSION_METADATA
          ? {
              id: env.CF_VERSION_METADATA.id,
              sourceCommit: /^[a-f0-9]{40}$/.test(env.CF_VERSION_METADATA.tag) ? env.CF_VERSION_METADATA.tag : null,
            }
          : null,
        workspaceSchema: await sha256(JSON.stringify(workspace.schema)),
        directorySchema: await sha256(JSON.stringify(directory.schema)),
      },
    },
    async () => {
      if (
        (await sha256(JSON.stringify(captureSqlite(driver)))) !== workspaceHash ||
        (await sha256(JSON.stringify(await captureDirectory(env.ACCOUNTS!)))) !== directoryHash
      )
        throw new Error("Workspace or directory changed during backup; no manifest was published");
    },
  );
  return { ...publication, ...sequences };
}

export async function prepareRestore(
  driver: SqlDriver,
  env: BackupEnvironment,
  workspaceId: string,
  key: string,
): Promise<BackupBundle> {
  if (env.BACKUP_RESTORE_ISOLATED !== "true") throw new Error("Isolated restore is not enabled");
  if (!env.BACKUPS || !env.ACCOUNTS) throw new Error("Private backup storage is not configured");
  const bundle = await loadBackup(env.BACKUPS, key, workspaceId);
  const sourceCommit = bundle.manifest.workerVersion?.sourceCommit;
  if (
    sourceCommit &&
    env.CF_VERSION_METADATA?.tag !== sourceCommit &&
    env.BACKUP_RESTORE_SOURCE_COMMIT !== sourceCommit
  )
    throw new Error("Restore requires the backup source commit");
  requireLinkage(workspaceId, bundle.workspace, bundle.directory);
  if (
    JSON.stringify(snapshotSequences(bundle.workspace)) !==
    JSON.stringify({ mainSeq: bundle.manifest.mainSeq, eventSeq: bundle.manifest.eventSeq })
  )
    throw new Error("Backup sequence metadata is inconsistent");
  validateBodies(bundle.workspace, bundle.documents);
  validateRestore(bundle.workspace, captureSqlite(driver), "__migrations");
  validateRestore(bundle.directory, await captureDirectory(env.ACCOUNTS), "d1_migrations");
  return bundle;
}

/** Call only after preflight, in an isolated target marked unavailable until completion. */
export async function applyRestore(
  driver: SqlDriver,
  env: BackupEnvironment,
  workspaceId: string,
  bundle: BackupBundle,
): Promise<void> {
  if (env.BACKUP_RESTORE_ISOLATED !== "true" || !env.ACCOUNTS) throw new Error("Isolated restore is not enabled");
  for (const body of bundle.documents) {
    const restoredHash = await env.DOCUMENTS.getByName(
      documentName(workspaceId, body.issueId, body.incarnation),
    ).restoreSnapshot(workspaceId, body.issueId, body.incarnation, body.state);
    if (restoredHash !== body.state.contentState)
      throw new Error("Restored document acknowledgement does not match its hash");
  }
  await restoreDirectory(env.ACCOUNTS, bundle.directory);
  restoreSqlite(driver, bundle.workspace);
}
