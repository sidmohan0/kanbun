import { DurableObject } from "cloudflare:workers";
import * as Y from "yjs";
import type { Actor } from "@kanbun/sync";
import { validateDocumentBackup, type StoredDocumentBackup } from "./backup-format";
import { documentName } from "./document-identity";
export { documentName } from "./document-identity";

export type DocumentSnapshot = { update: string; mirror: string; contentState: string };
type StoredDocument = DocumentSnapshot & { editor: Actor };
type DocumentEnvironment = { DOCUMENTS: DurableObjectNamespace<DocumentDO>; BACKUP_RESTORE_ISOLATED?: string };

export function encodeUpdate(update: Uint8Array): string {
  let binary = "";
  for (const byte of update) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeUpdate(encoded: string): Uint8Array {
  // Require canonical base64, rather than silently accepting truncated or non-binary inputs.
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeUpdate(bytes) !== encoded) throw new Error("Invalid document update");
  return bytes;
}

/** One SQLite-backed body. Only WorkspaceDO's private namespace binding calls this RPC.
 * It never calls back into WorkspaceDO, so the workspace can serialize publication and retry
 * the durable body after an interrupted mirror write without a distributed transaction.
 */
export class DocumentDO extends DurableObject<DocumentEnvironment> {
  private operation: Promise<unknown> = Promise.resolve();

  private requireIdentity(workspaceId: string, issueId: string, incarnation: string) {
    if (
      this.ctx.id.toString() !==
      this.env.DOCUMENTS.idFromName(documentName(workspaceId, issueId, incarnation)).toString()
    )
      throw new Error("Document identity does not match its authority");
  }

  /** Private namespace RPC. Reading a never-opened body does not initialize or edit it. */
  snapshot(workspaceId: string, issueId: string, incarnation: string): Promise<StoredDocumentBackup | null> {
    const operation = this.operation
      .catch(() => {})
      .then(async () => {
        this.requireIdentity(workspaceId, issueId, incarnation);
        const state = await this.ctx.storage.get<StoredDocument>("document");
        return state ? validateDocumentBackup(state) : null;
      });
    this.operation = operation;
    return operation;
  }

  /** Recovery is allowed only in an explicitly isolated deployment and an unused body. */
  restoreSnapshot(
    workspaceId: string,
    issueId: string,
    incarnation: string,
    value: StoredDocumentBackup,
  ): Promise<string> {
    const operation = this.operation
      .catch(() => {})
      .then(async () => {
        if (this.env.BACKUP_RESTORE_ISOLATED !== "true") throw new Error("Isolated restore is not enabled");
        this.requireIdentity(workspaceId, issueId, incarnation);
        const state = await validateDocumentBackup(value);
        return this.ctx.storage.transaction(async (transaction) => {
          if ((await transaction.get("document")) !== undefined)
            throw new Error("Document restore target is not empty");
          await transaction.put("document", state);
          return state.contentState;
        });
      });
    this.operation = operation;
    return operation;
  }

  synchronize(
    workspaceId: string,
    issueId: string,
    incarnation: string,
    editor: Actor,
    initialText: string,
    update?: string,
    expiresAt?: number,
  ): Promise<StoredDocument> {
    const operation = this.operation
      .catch(() => {})
      .then(async () => {
        const requireUnexpired = () => {
          if (expiresAt !== undefined && expiresAt <= Date.now()) throw new Error("Document authorization expired");
        };
        requireUnexpired();
        this.requireIdentity(workspaceId, issueId, incarnation);
        if (editor.type !== "user") throw new Error("Only people may edit collaborative descriptions");
        const previous = await this.ctx.storage.get<StoredDocument>("document");
        const doc = new Y.Doc();
        try {
          if (previous) Y.applyUpdate(doc, decodeUpdate(previous.update));
          else if (initialText) doc.getText("description").insert(0, initialText);
          if (update !== undefined) {
            try {
              Y.applyUpdate(doc, decodeUpdate(update));
              for (const name of doc.share.keys())
                if (name !== "description") throw new Error("Unexpected document field");
            } catch {
              throw new Error("Invalid document update");
            }
          }
          let mirror: string;
          try {
            mirror = doc.getText("description").toString();
          } catch {
            throw new Error("Invalid document update");
          }
          const state = Y.encodeStateAsUpdate(doc);
          // Hash the complete update, including deletion sets: a state vector alone misses deletes.
          const digest = await crypto.subtle.digest("SHA-256", state);
          const contentState = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
            "",
          );
          if (previous?.contentState === contentState) return previous;
          const result = { update: encodeUpdate(state), mirror, contentState, editor };
          requireUnexpired();
          await this.ctx.storage.put("document", result);
          return result;
        } finally {
          doc.destroy();
        }
      });
    this.operation = operation;
    return operation;
  }
}
