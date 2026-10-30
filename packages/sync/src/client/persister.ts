import type { ModelName } from "@kanbun/model";
import type { Mutation } from "../protocol";

export type PersistedState = {
  clientId: string;
  userId: string;
  seq: number;
  lastMutationId: number;
  pending: Mutation[];
  rows: Partial<Record<ModelName, Record<string, unknown>[]>>;
};

export interface Persister {
  load(): Promise<PersistedState | null>;
  save(state: PersistedState): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryPersister implements Persister {
  private state: PersistedState | null = null;
  async load() {
    return this.state ? structuredClone(this.state) : null;
  }
  async save(s: PersistedState) {
    this.state = structuredClone(s);
  }
  async clear() {
    this.state = null;
  }
}

/**
 * IndexedDB persister: one object store, one record per workspace+user.
 * Whole-state writes are fine at this scale (5k issues ≈ 5 MB) and are
 * coalesced so at most one write is in flight.
 */
export class IndexedDbPersister implements Persister {
  private queued: PersistedState | null = null;
  private writing: Promise<void> | null = null;

  constructor(
    private readonly dbName: string,
    private readonly key: string,
  ) {}

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("state");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async load(): Promise<PersistedState | null> {
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("state", "readonly");
        const req = tx.objectStore("state").get(this.key);
        req.onsuccess = () => resolve((req.result as PersistedState | undefined) ?? null);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      });
    } catch {
      return null;
    }
  }

  async save(state: PersistedState): Promise<void> {
    this.queued = state;
    if (this.writing) return this.writing;
    this.writing = (async () => {
      try {
        while (this.queued) {
          const s = this.queued;
          this.queued = null;
          const db = await this.open();
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction("state", "readwrite");
            tx.objectStore("state").put(s, this.key);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          });
        }
      } catch {
        /* storage is a convenience; never fail the app over it */
      } finally {
        this.writing = null;
      }
    })();
    return this.writing;
  }

  async clear(): Promise<void> {
    try {
      const db = await this.open();
      await new Promise<void>((resolve) => {
        const tx = db.transaction("state", "readwrite");
        tx.objectStore("state").delete(this.key);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      });
    } catch {
      /* ignore */
    }
  }
}
