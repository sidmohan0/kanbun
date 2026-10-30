import * as Y from "yjs";
import { z } from "zod";
import type { R2Bucket } from "@cloudflare/workers-types";
import { databaseSnapshotSchema, type DatabaseSnapshot } from "./backup-sql";

export const storedDocumentSchema = z.strictObject({
  update: z.string(),
  mirror: z.string(),
  contentState: z.string().regex(/^[a-f0-9]{64}$/),
  editor: z.strictObject({ id: z.string().min(1), type: z.literal("user"), via: z.string().optional() }),
});
export type StoredDocumentBackup = z.infer<typeof storedDocumentSchema>;
export const bodyBackupSchema = z.strictObject({
  issueId: z.string().min(1),
  incarnation: z.string().min(1),
  state: storedDocumentSchema,
});
export type BodyBackup = z.infer<typeof bodyBackupSchema>;
const partSchema = z.strictObject({
  kind: z.enum(["workspace", "directory", "documents"]),
  key: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const backupManifestSchema = z.strictObject({
  format: z.literal(1),
  workspaceId: z.string().min(1),
  createdAt: z.iso.datetime(),
  workerVersion: z
    .strictObject({
      id: z.string(),
      sourceCommit: z
        .string()
        .regex(/^[a-f0-9]{40}$/)
        .nullable(),
    })
    .nullable(),
  mainSeq: z.number().int().nonnegative(),
  eventSeq: z.number().int().nonnegative(),
  workspaceSchema: z.string().regex(/^[a-f0-9]{64}$/),
  directorySchema: z.string().regex(/^[a-f0-9]{64}$/),
  parts: z.array(partSchema),
});
export type BackupManifest = z.infer<typeof backupManifestSchema>;
export type BackupBundle = {
  manifest: BackupManifest;
  workspace: DatabaseSnapshot;
  directory: DatabaseSnapshot;
  documents: BodyBackup[];
};

export async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : Uint8Array.from(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function validateDocumentBackup(value: unknown): Promise<StoredDocumentBackup> {
  const state = storedDocumentSchema.parse(value);
  const binary = atob(state.update);
  if (btoa(binary) !== state.update) throw new Error("Invalid document backup encoding");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if ((await sha256(bytes)) !== state.contentState) throw new Error("Document backup hash mismatch");
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, bytes);
    for (const name of doc.share.keys())
      if (name !== "description") throw new Error("Unexpected document backup field");
    if (doc.getText("description").toString() !== state.mirror) throw new Error("Document backup mirror mismatch");
  } finally {
    doc.destroy();
  }
  return state;
}

/** Parts are immutable. Without a manifest, a failed partial upload is never a usable backup. */
export async function publishBackup(
  bucket: R2Bucket,
  bundle: Omit<BackupBundle, "manifest"> & { manifest: Omit<BackupManifest, "parts"> },
  beforeManifest: () => Promise<void>,
): Promise<{ key: string; manifestHash: string }> {
  const prefix = `workspaces/${bundle.manifest.workspaceId}/${crypto.randomUUID()}`;
  const parts: BackupManifest["parts"] = [];
  for (const kind of ["workspace", "directory", "documents"] as const) {
    const data = JSON.stringify(bundle[kind]);
    const key = `${prefix}/${kind}.json`;
    const digest = await sha256(data);
    const written = await bucket.put(key, data, {
      onlyIf: { etagDoesNotMatch: "*" },
      sha256: digest,
      httpMetadata: { contentType: "application/json" },
    });
    if (!written) throw new Error("Backup part already exists");
    parts.push({ kind, key, sha256: digest });
  }
  await beforeManifest();
  const key = `${prefix}/manifest.json`;
  const manifest = JSON.stringify({ ...bundle.manifest, parts });
  const manifestHash = await sha256(manifest);
  if (
    !(await bucket.put(key, manifest, {
      onlyIf: { etagDoesNotMatch: "*" },
      sha256: manifestHash,
      httpMetadata: { contentType: "application/json" },
    }))
  )
    throw new Error("Backup manifest already exists");
  return { key, manifestHash };
}

export async function loadBackup(bucket: R2Bucket, key: string, workspaceId: string): Promise<BackupBundle> {
  const object = await bucket.get(key);
  if (!object) throw new Error("Backup manifest is missing");
  const manifest = backupManifestSchema.parse(await object.json());
  if (
    manifest.workspaceId !== workspaceId ||
    !key.startsWith(`workspaces/${workspaceId}/`) ||
    !key.endsWith("/manifest.json")
  )
    throw new Error("Backup belongs to another workspace");
  const prefix = key.slice(0, -"manifest.json".length);
  const values = new Map<string, unknown>();
  for (const part of manifest.parts) {
    if (values.has(part.kind) || part.key !== `${prefix}${part.kind}.json`)
      throw new Error("Backup part inventory is invalid");
    const stored = await bucket.get(part.key);
    if (!stored) throw new Error("Backup part is missing");
    const data = await stored.text();
    if ((await sha256(data)) !== part.sha256) throw new Error("Backup part hash mismatch");
    values.set(part.kind, JSON.parse(data));
  }
  if (values.size !== 3) throw new Error("Backup is incomplete");
  const workspace = databaseSnapshotSchema.parse(values.get("workspace"));
  const directory = databaseSnapshotSchema.parse(values.get("directory"));
  if (
    (await sha256(JSON.stringify(workspace.schema))) !== manifest.workspaceSchema ||
    (await sha256(JSON.stringify(directory.schema))) !== manifest.directorySchema
  )
    throw new Error("Backup schema hash mismatch");
  const documents = z.array(bodyBackupSchema).parse(values.get("documents"));
  for (const body of documents) await validateDocumentBackup(body.state);
  return { manifest, workspace, directory, documents };
}
