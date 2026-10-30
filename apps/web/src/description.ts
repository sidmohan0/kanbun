import * as Y from "yjs";
import type { Row } from "@kanbun/model";
import { issueIncarnation, type WorkspaceContext } from "@kanbun/sync";
import { workspace } from "./workspace";

const remote = Symbol("remote description");
class DescriptionNetworkError extends Error {}

type SavedDescription = { version: 1; update: string; pending: boolean };
export type DescriptionSnapshot = {
  text: string;
  ready: boolean;
  blocked: boolean;
  status: string;
  error: string | null;
};

function encode(update: Uint8Array): string {
  let binary = "";
  for (const byte of update) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function decode(update: string): Uint8Array {
  return Uint8Array.from(atob(update), (character) => character.charCodeAt(0));
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("kanbun-documents", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("states");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Description storage could not be opened."));
    request.onblocked = () => reject(new Error("Description storage is blocked by another page."));
  });
}
async function readSaved(key: string): Promise<SavedDescription | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction("states", "readonly");
      const request = transaction.objectStore("states").get(key);
      let value: unknown = null;
      request.onsuccess = () => {
        value = request.result;
      };
      transaction.oncomplete = () => {
        if (value === undefined || value === null) return resolve(null);
        if (
          typeof value !== "object" ||
          !("version" in value) ||
          value.version !== 1 ||
          !("update" in value) ||
          typeof value.update !== "string" ||
          !("pending" in value) ||
          typeof value.pending !== "boolean"
        ) {
          reject(new Error("Saved description data is invalid. It has been preserved for recovery."));
          return;
        }
        resolve(value as SavedDescription);
      };
      transaction.onerror = () => reject(transaction.error ?? new Error("Description storage read failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Description storage read aborted."));
    });
  } finally {
    database.close();
  }
}
async function writeSaved(key: string, value: SavedDescription): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("states", "readwrite");
      transaction.objectStore("states").put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Description storage write failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Description storage write aborted."));
    });
  } finally {
    database.close();
  }
}

/** A page owns one document per authenticated identity; routing cannot discard an unsent edit. */
export class DescriptionSession {
  private readonly doc = new Y.Doc();
  private readonly text = this.doc.getText("description");
  private readonly listeners = new Set<() => void>();
  private initialized = false;
  private ready = false;
  private blocked = false;
  private blockedMessage = "Sign in again to open this description.";
  private storageReadFailed = false;
  private revision = 0;
  private dirty = false;
  private connectionUnavailable = false;
  private localWrites = 0;
  private persistedRevision = 0;
  private error: string | null = null;
  private saveTail: Promise<void> = Promise.resolve();
  private syncTask: Promise<void> | null = null;
  private syncRequested = false;
  private lastIssueStamp = "";
  private previousWorkspaceStatus = workspace.getSnapshot().status;
  private snapshot: DescriptionSnapshot = {
    text: "",
    ready: false,
    blocked: false,
    status: "Opening description…",
    error: null,
  };

  constructor(
    private readonly context: WorkspaceContext,
    readonly issueId: string,
    private readonly incarnation: string,
    private readonly key: string,
  ) {
    workspace.subscribe(() => {
      const current = workspace.getSnapshot();
      if (current.authenticationRequired) return this.block();
      if (
        current.context &&
        (current.context.workspaceId !== this.context.workspaceId ||
          current.context.mode !== this.context.mode ||
          current.context.actor.type !== this.context.actor.type ||
          current.context.actor.id !== this.context.actor.id)
      )
        return this.block("Workspace identity changed. Reload to open this issue.");
      const issue = current.issues.find((candidate) => candidate.id === this.issueId);
      if (issue && issueIncarnation(issue) !== this.incarnation)
        return this.block("This issue was replaced. Reopen it before editing its description.");
      if (current.phase === "ready" && !issue)
        return this.block("This issue is no longer available in this workspace.");
      const stamp = issue ? JSON.stringify([issue.updatedSeq, issue.descriptionContentId, issue.description]) : "";
      const changed = stamp !== this.lastIssueStamp;
      const reconnected = current.status === "idle" && this.previousWorkspaceStatus !== "idle";
      this.previousWorkspaceStatus = current.status;
      this.lastIssueStamp = stamp;
      if (changed || reconnected) this.refresh();
    });
    window.addEventListener("focus", this.refresh);
    window.addEventListener("online", this.refresh);
    window.addEventListener("offline", () => this.publish());
    void this.initialize();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;

  private publish() {
    const status = this.blocked
      ? this.blockedMessage
      : this.error
        ? "Description needs attention"
        : !this.ready
          ? "Opening description…"
          : this.localWrites > 0 || this.persistedRevision < this.revision
            ? "Saving on this device…"
            : !navigator.onLine || this.connectionUnavailable
              ? this.dirty
                ? "Saved on this device · waiting for connection"
                : "Offline · saved on this device"
              : this.dirty || this.syncTask
                ? "Syncing description…"
                : "Saved";
    this.snapshot = {
      text: this.blocked ? "" : this.text.toString(),
      ready: this.ready && !this.storageReadFailed,
      blocked: this.blocked,
      status,
      error: this.error,
    };
    for (const listener of this.listeners) listener();
  }

  private block(message = "Sign in again and reload before opening this description.") {
    this.blocked = true;
    this.blockedMessage = message;
    this.error = message;
    this.syncRequested = false;
    this.publish();
  }

  private async initialize() {
    try {
      const saved = await readSaved(this.key);
      if (saved) {
        const bytes = decode(saved.update);
        const restored = new Y.Doc();
        try {
          Y.applyUpdate(restored, bytes);
        } finally {
          restored.destroy();
        }
        Y.applyUpdate(this.doc, bytes, remote);
        this.dirty = saved.pending;
        this.ready = true;
      }
      this.doc.on("update", (_update: Uint8Array, origin: unknown) => {
        if (origin === remote) return;
        this.revision++;
        this.dirty = true;
        this.error = null;
        this.publish();
        void this.persist().then(this.refresh, () => {});
      });
      this.initialized = true;
      this.publish();
      this.refresh();
    } catch (failure) {
      this.storageReadFailed = true;
      this.error = failure instanceof Error ? failure.message : "Description storage could not be read.";
      this.publish();
    }
  }

  private persist(): Promise<void> {
    const revision = this.revision;
    const value: SavedDescription = {
      version: 1,
      update: encode(Y.encodeStateAsUpdate(this.doc)),
      pending: this.dirty,
    };
    this.localWrites++;
    this.publish();
    const task = this.saveTail.catch(() => {}).then(() => writeSaved(this.key, value));
    this.saveTail = task;
    return task
      .then(
        () => {
          this.persistedRevision = Math.max(this.persistedRevision, revision);
        },
        (failure: unknown) => {
          this.error = failure instanceof Error ? failure.message : "Description storage write failed.";
          throw failure;
        },
      )
      .finally(() => {
        this.localWrites--;
        this.publish();
      });
  }

  edit(value: string) {
    if (!this.ready || this.blocked || this.storageReadFailed) return;
    const previous = this.text.toString();
    let prefix = 0;
    while (prefix < previous.length && prefix < value.length && previous[prefix] === value[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix < previous.length - prefix &&
      suffix < value.length - prefix &&
      previous[previous.length - suffix - 1] === value[value.length - suffix - 1]
    )
      suffix++;
    // Do not split a UTF-16 surrogate pair while computing the changed range.
    if (prefix > 0 && prefix < previous.length && /[\uDC00-\uDFFF]/u.test(previous[prefix]!)) prefix--;
    if (suffix > 0 && suffix < previous.length - prefix && /[\uDC00-\uDFFF]/u.test(previous[previous.length - suffix]!))
      suffix--;
    this.doc.transact(() => {
      const removed = previous.length - prefix - suffix;
      if (removed) this.text.delete(prefix, removed);
      const inserted = value.slice(prefix, value.length - suffix);
      if (inserted) this.text.insert(prefix, inserted);
    }, "editor");
  }

  refresh = () => {
    if (this.blocked) return;
    if (this.storageReadFailed) {
      this.storageReadFailed = false;
      this.error = null;
      this.publish();
      void this.initialize();
      return;
    }
    if (!this.initialized) return;
    this.syncRequested = true;
    if (this.syncTask) return;
    const run = async () => {
      while (this.syncRequested && !this.blocked) {
        this.syncRequested = false;
        if (!navigator.onLine) break;
        const revision = this.revision;
        const posting = this.dirty;
        const update = posting ? encode(Y.encodeStateAsUpdate(this.doc)) : null;
        // A request may only acknowledge state that already survives a browser reload.
        if (posting) await this.persist();
        if (this.blocked || workspace.getSnapshot().authenticationRequired) break;
        const response = await fetch(
          posting
            ? "/sync/document"
            : `/sync/document?issueId=${encodeURIComponent(this.issueId)}&incarnation=${encodeURIComponent(this.incarnation)}`,
          {
            method: posting ? "POST" : "GET",
            credentials: "include",
            cache: "no-store",
            redirect: "manual",
            ...(posting
              ? {
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ issueId: this.issueId, incarnation: this.incarnation, update }),
                }
              : {}),
          },
        ).catch(() => {
          this.connectionUnavailable = true;
          throw new DescriptionNetworkError("Connection unavailable. Reconnect and retry to open the description.");
        });
        if (this.blocked || workspace.getSnapshot().authenticationRequired) {
          this.block();
          break;
        }
        if (
          response.type === "opaqueredirect" ||
          response.status === 401 ||
          response.status === 403 ||
          (response.status >= 300 && response.status < 400)
        ) {
          this.block();
          if (this.context.mode === "hosted") workspace.requireAuthentication();
          break;
        }
        this.connectionUnavailable = false;
        if (response.status === 409) {
          this.block("This issue has changed. Reopen it before editing its description.");
          break;
        }
        if (!response.ok)
          throw new Error(`Description sync failed (HTTP ${response.status}). Your local changes have been preserved.`);
        const value: unknown = await response.json();
        if (
          typeof value !== "object" ||
          value === null ||
          !("update" in value) ||
          typeof value.update !== "string" ||
          !("mirror" in value) ||
          typeof value.mirror !== "string" ||
          !("incarnation" in value) ||
          value.incarnation !== this.incarnation ||
          !("contentState" in value) ||
          typeof value.contentState !== "string"
        )
          throw new Error("The server returned an invalid description.");
        if (this.blocked || workspace.getSnapshot().authenticationRequired) break;
        // Remote merges never become new local edits; unacknowledged edits made during a request stay pending.
        Y.applyUpdate(this.doc, decode(value.update), remote);
        if (posting) this.dirty = this.revision !== revision;
        this.error = null;
        this.ready = true;
        await this.persist();
        this.syncRequested ||= this.dirty;
      }
    };
    const task = run()
      .catch((failure: unknown) => {
        this.error =
          failure instanceof DescriptionNetworkError && this.ready
            ? null
            : failure instanceof Error
              ? failure.message
              : "Description sync failed. Your local changes have been preserved.";
      })
      .finally(() => {
        if (this.syncTask === task) this.syncTask = null;
        this.publish();
      });
    this.syncTask = task;
    this.publish();
  };
}

const sessions = new Map<string, DescriptionSession>();
export function descriptionSession(context: WorkspaceContext, issue: Row<"issue">): DescriptionSession {
  const issueId = issue.id;
  const incarnation = issueIncarnation(issue);
  const key = JSON.stringify([
    "v2",
    context.mode,
    context.workspaceId,
    context.actor.type,
    context.actor.id,
    "main",
    issueId,
    incarnation,
  ]);
  let session = sessions.get(key);
  if (!session) {
    session = new DescriptionSession(context, issueId, incarnation, key);
    sessions.set(key, session);
  }
  return session;
}
export function refreshDescriptions() {
  for (const session of sessions.values()) session.refresh();
}
