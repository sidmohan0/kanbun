import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { nodeSqliteDriver } from "@kanbun/sync/server";
import * as Y from "yjs";
import { captureDirectory, captureSqlite, restoreDirectory, restoreSqlite, validateRestore } from "../src/backup-sql";
import { loadBackup, publishBackup, sha256, validateDocumentBackup, type BackupBundle } from "../src/backup-format";
import { applyRestore, createBackup, prepareRestore } from "../src/backups";

function workspaceFixture(seed: boolean) {
  const workspace = new DatabaseSync(":memory:"),
    accounts = new DatabaseSync(":memory:");
  workspace.exec(
    "CREATE TABLE organization(id TEXT PRIMARY KEY); CREATE TABLE issue(id TEXT, created_seq INTEGER, created_at TEXT, description TEXT, description_content_id TEXT); CREATE TABLE document_content(id TEXT, issue_id TEXT, content TEXT, content_state TEXT); CREATE TABLE sync_log(seq INTEGER, branch_id TEXT); CREATE TABLE event_log(seq INTEGER, branch_id TEXT); CREATE TABLE sync_client(client_id TEXT,last_mutation_id INTEGER)",
  );
  accounts.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY); CREATE TABLE accounts(id TEXT PRIMARY KEY)");
  if (seed) {
    workspace.exec("INSERT INTO organization VALUES('fixture-workspace'); INSERT INTO sync_client VALUES('client',1)");
    accounts.exec("INSERT INTO workspaces VALUES('fixture-workspace')");
  }
  return {
    workspace,
    accounts,
    close() {
      workspace.close();
      accounts.close();
    },
  };
}

const schema = `CREATE TABLE __migrations(tag TEXT PRIMARY KEY, applied_at TEXT); CREATE TABLE item(id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT, body BLOB); CREATE INDEX item_value ON item(value);`;
function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  return db;
}

function directory(db: DatabaseSync, beforeImport?: () => void) {
  const statement = (sql: string, bindings: unknown[] = []) => ({
    sql,
    bindings,
    bind(...values: unknown[]) {
      return statement(sql, values);
    },
    async all() {
      return { results: db.prepare(sql).all(...(bindings as never[])) };
    },
  });
  return {
    prepare: statement,
    async batch(statements: ReturnType<typeof statement>[]) {
      if (statements[0]?.sql.includes("empty_target")) beforeImport?.();
      db.exec("BEGIN");
      try {
        const result = statements.map((entry) => ({
          results: db.prepare(entry.sql).all(...(entry.bindings as never[])),
        }));
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as Parameters<typeof captureDirectory>[0];
}

class Bucket {
  readonly objects = new Map<string, string>();
  readonly conditions: unknown[] = [];
  failKind = "";
  afterWorkspacePart: (() => void) | undefined;
  async put(key: string, value: string, options: { onlyIf?: unknown }) {
    this.conditions.push(options.onlyIf);
    if (key.endsWith(`/${this.failKind}.json`)) throw new Error("Fixture upload failure");
    if (this.objects.has(key)) return null;
    this.objects.set(key, value);
    if (key.endsWith("/workspace.json")) this.afterWorkspacePart?.();
    return { key };
  }
  async get(key: string) {
    const value = this.objects.get(key);
    return value === undefined ? null : { text: async () => value, json: async () => JSON.parse(value) };
  }
  binding() {
    return this as unknown as Parameters<typeof loadBackup>[0];
  }
}

async function archiveFixture(): Promise<
  Omit<BackupBundle, "manifest"> & { manifest: Omit<BackupBundle["manifest"], "parts"> }
> {
  const db = database();
  try {
    const workspace = captureSqlite(nodeSqliteDriver(db));
    return {
      workspace,
      directory: workspace,
      documents: [],
      manifest: {
        format: 1,
        workspaceId: "fixture-workspace",
        createdAt: new Date().toISOString(),
        mainSeq: 0,
        eventSeq: 0,
        workerVersion: null,
        workspaceSchema: await sha256(JSON.stringify(workspace.schema)),
        directorySchema: await sha256(JSON.stringify(workspace.schema)),
      },
    };
  } finally {
    db.close();
  }
}

describe("complete SQLite backups", () => {
  it("restores rows, binary data, indexes, migration journal and deleted-row sequence high-watermarks", () => {
    const source = database(),
      target = database();
    try {
      source.prepare("INSERT INTO __migrations VALUES (?, ?)").run("migration-1", "2026-10-30T00:00:00Z");
      for (const db of [source, target])
        db.exec(
          "CREATE TABLE __miniflare_metadata(id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT); INSERT INTO __miniflare_metadata(value) VALUES('Local backend metadata')",
        );
      source.exec("INSERT INTO __miniflare_metadata(value) VALUES('Source-only backend metadata')");
      target.exec("INSERT INTO sqlite_sequence(name,seq) VALUES('item',0)");
      source.prepare("INSERT INTO item(value,body) VALUES (?,?)").run("日本語", new Uint8Array([0, 255, 42]));
      source.prepare("INSERT INTO item(value) VALUES (?)").run("Deleted high-watermark");
      source.exec("DELETE FROM item WHERE id=2");
      const snapshot = captureSqlite(nodeSqliteDriver(source));
      restoreSqlite(nodeSqliteDriver(target), snapshot);
      expect(captureSqlite(nodeSqliteDriver(target))).toEqual(snapshot);
      expect(target.prepare("SELECT value FROM __miniflare_metadata").all()).toEqual([
        { value: "Local backend metadata" },
      ]);
      expect(target.prepare("INSERT INTO item(value) VALUES (?) RETURNING id").get("After recovery")?.["id"]).toBe(3);
    } finally {
      source.close();
      target.close();
    }
  });

  it("rejects altered schemas, missing or duplicate tables, malformed rows and used targets without overwriting data", () => {
    const source = database(),
      target = database();
    try {
      const snapshot = captureSqlite(nodeSqliteDriver(source)),
        fresh = captureSqlite(nodeSqliteDriver(target));
      const altered = structuredClone(snapshot);
      altered.schema[0]!.sql = "DROP TABLE item";
      expect(() => validateRestore(altered, fresh, "__migrations")).toThrow(/schema/);
      const duplicate = structuredClone(snapshot);
      duplicate.tables[1] = duplicate.tables[0]!;
      expect(() => validateRestore(duplicate, fresh, "__migrations")).toThrow(/inventory/);
      const malformed = structuredClone(snapshot);
      malformed.tables.find((table) => table.name === "item")!.rows.push([1]);
      expect(() => restoreSqlite(nodeSqliteDriver(target), malformed)).toThrow(/columns/);
      target.exec("INSERT INTO item(value) VALUES ('Keep this data')");
      expect(() => restoreSqlite(nodeSqliteDriver(target), snapshot)).toThrow(/not empty/);
      expect(target.prepare("SELECT value FROM item").get()?.["value"]).toBe("Keep this data");
      target.exec("DELETE FROM item");
      expect(() => restoreSqlite(nodeSqliteDriver(target), snapshot)).toThrow(/existing application counters/);
    } finally {
      source.close();
      target.close();
    }
  });

  it("D1 import checks emptiness atomically when a member arrives after preflight", async () => {
    const source = new DatabaseSync(":memory:"),
      target = new DatabaseSync(":memory:");
    try {
      for (const db of [source, target])
        db.exec(
          "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT); INSERT INTO d1_migrations(name) VALUES('migration'); CREATE TABLE accounts(id TEXT PRIMARY KEY,email TEXT)",
        );
      source.exec("INSERT INTO accounts VALUES('archived-owner','owner@example.test')");
      const snapshot = await captureDirectory(directory(source));
      const racing = directory(target, () =>
        target.exec("INSERT INTO accounts VALUES('current-owner','current@example.test')"),
      );
      await expect(restoreDirectory(racing, snapshot)).rejects.toThrow();
      expect(target.prepare("SELECT id FROM accounts").all()).toEqual([{ id: "current-owner" }]);
    } finally {
      source.close();
      target.close();
    }
  });
});

it("does not revive Google export authorization when restoring the directory", async () => {
  const source = new DatabaseSync(":memory:"),
    target = new DatabaseSync(":memory:");
  try {
    for (const db of [source, target])
      db.exec(
        "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO d1_migrations VALUES(1,'fixture'); CREATE TABLE accounts(id TEXT PRIMARY KEY); CREATE TABLE google_sheets_connections(workspace_id TEXT PRIMARY KEY, refresh_token TEXT)",
      );
    source.exec(
      "INSERT INTO accounts VALUES('owner'); INSERT INTO google_sheets_connections VALUES('workspace','encrypted-refresh-credential')",
    );
    await restoreDirectory(directory(target), await captureDirectory(directory(source)));
    expect(target.prepare("SELECT id FROM accounts").all()).toEqual([{ id: "owner" }]);
    expect(target.prepare("SELECT * FROM google_sheets_connections").all()).toEqual([]);
  } finally {
    source.close();
    target.close();
  }
});

describe("private immutable backup archives", () => {
  it("publishes the manifest last with conditional-create parts and verifies their hashes", async () => {
    const bucket = new Bucket(),
      bundle = await archiveFixture();
    let checked = false;
    const { key } = await publishBackup(bucket.binding(), bundle, async () => {
      expect([...bucket.objects.keys()]).toHaveLength(3);
      expect([...bucket.objects.keys()].some((entry) => entry.endsWith("manifest.json"))).toBe(false);
      checked = true;
    });
    expect(checked).toBe(true);
    expect(bucket.conditions).toEqual(Array(4).fill({ etagDoesNotMatch: "*" }));
    expect((await loadBackup(bucket.binding(), key, bundle.manifest.workspaceId)).workspace).toEqual(bundle.workspace);
    await expect(loadBackup(bucket.binding(), key, "another-workspace")).rejects.toThrow(/another workspace/);
    const part = [...bucket.objects.keys()].find((entry) => entry.endsWith("workspace.json"))!;
    bucket.objects.set(part, '{"tampered":true}');
    await expect(loadBackup(bucket.binding(), key, bundle.manifest.workspaceId)).rejects.toThrow(/hash mismatch/);
  });

  it("failed uploads and changed source state never publish a usable manifest", async () => {
    for (const failure of ["directory", "consistency"]) {
      const bucket = new Bucket(),
        bundle = await archiveFixture();
      if (failure === "directory") bucket.failKind = "directory";
      await expect(
        publishBackup(bucket.binding(), bundle, async () => {
          if (failure === "consistency") throw new Error("Workspace changed");
        }),
      ).rejects.toThrow();
      expect(bucket.objects.size).toBeGreaterThan(0);
      expect([...bucket.objects.keys()].some((key) => key.endsWith("manifest.json"))).toBe(false);
    }
    const bucket = new Bucket(),
      bundle = await archiveFixture();
    const { key } = await publishBackup(bucket.binding(), bundle, async () => {});
    bucket.objects.delete([...bucket.objects.keys()].find((entry) => entry.endsWith("documents.json"))!);
    await expect(loadBackup(bucket.binding(), key, bundle.manifest.workspaceId)).rejects.toThrow(/part is missing/);
  });

  it("validates the complete Yjs bytes and mirror before any document restore", async () => {
    const doc = new Y.Doc();
    try {
      doc.getText("description").insert(0, "Recover this exact collaborative body.");
      const bytes = Y.encodeStateAsUpdate(doc);
      const state = {
        update: Buffer.from(bytes).toString("base64"),
        mirror: doc.getText("description").toString(),
        contentState: await sha256(bytes),
        editor: { id: "owner", type: "user" as const },
      };
      expect(await validateDocumentBackup(state)).toEqual(state);
      await expect(validateDocumentBackup({ ...state, mirror: "Wrong mirror" })).rejects.toThrow(/mirror mismatch/);
      await expect(validateDocumentBackup({ ...state, update: state.update + "AA==" })).rejects.toThrow();
      await expect(validateDocumentBackup({ ...state, contentState: "0".repeat(64) })).rejects.toThrow(/hash mismatch/);
    } finally {
      doc.destroy();
    }
  });

  it("rechecks full workspace and directory data even when their main sequence did not change", async () => {
    for (const change of ["client", "directory"]) {
      const fixture = workspaceFixture(true),
        { workspace, accounts } = fixture;
      try {
        const bucket = new Bucket();
        bucket.afterWorkspacePart = () => {
          if (change === "client") workspace.exec("UPDATE sync_client SET last_mutation_id=2");
          else accounts.exec("INSERT INTO accounts VALUES('new-member')");
        };
        await expect(
          createBackup(
            nodeSqliteDriver(workspace),
            {
              ACCOUNTS: directory(accounts),
              BACKUPS: bucket.binding(),
              DOCUMENTS: { getByName: () => ({ snapshot: async () => null, restoreSnapshot: async () => "" }) },
            },
            "fixture-workspace",
          ),
        ).rejects.toThrow(/changed during backup/);
        expect([...bucket.objects.keys()].some((key) => key.endsWith("manifest.json"))).toBe(false);
      } finally {
        fixture.close();
      }
    }
  });

  it("requires the recorded source commit for a tagged archive before preparing an isolated restore", async () => {
    const source = workspaceFixture(true),
      target = workspaceFixture(false),
      bucket = new Bucket();
    const documents = { getByName: () => ({ snapshot: async () => null, restoreSnapshot: async () => "" }) };
    const sourceCommit = "a".repeat(40);
    try {
      const receipt = await createBackup(
        nodeSqliteDriver(source.workspace),
        {
          ACCOUNTS: directory(source.accounts),
          BACKUPS: bucket.binding(),
          DOCUMENTS: documents,
          CF_VERSION_METADATA: { id: "source-worker-version", tag: sourceCommit, timestamp: new Date().toISOString() },
        },
        "fixture-workspace",
      );
      const env = {
        ACCOUNTS: directory(target.accounts),
        BACKUPS: bucket.binding(),
        DOCUMENTS: documents,
        BACKUP_RESTORE_ISOLATED: "true",
      };
      await expect(
        prepareRestore(nodeSqliteDriver(target.workspace), env, "fixture-workspace", receipt.key),
      ).rejects.toThrow(/source commit/);
      const bundle = await prepareRestore(
        nodeSqliteDriver(target.workspace),
        { ...env, BACKUP_RESTORE_SOURCE_COMMIT: sourceCommit },
        "fixture-workspace",
        receipt.key,
      );
      expect(bundle.manifest.workerVersion).toEqual({ id: "source-worker-version", sourceCommit });
      expect(target.workspace.prepare("SELECT * FROM organization").all()).toEqual([]);
    } finally {
      source.close();
      target.close();
    }
  });

  it("restores 5,000 present rich bodies with exactly one target RPC per body", async () => {
    const source = workspaceFixture(true),
      target = workspaceFixture(false),
      bucket = new Bucket();
    const doc = new Y.Doc();
    try {
      doc.getText("description").insert(0, "A complete recoverable rich body.");
      const bytes = Y.encodeStateAsUpdate(doc);
      const state = {
        update: Buffer.from(bytes).toString("base64"),
        mirror: doc.getText("description").toString(),
        contentState: await sha256(bytes),
        editor: { id: "owner", type: "user" as const },
      };
      const insertIssue = source.workspace.prepare("INSERT INTO issue VALUES(?,?,?,?,?)");
      const insertContent = source.workspace.prepare("INSERT INTO document_content VALUES(?,?,?,?)");
      const insertEvent = source.workspace.prepare("INSERT INTO event_log VALUES(?,'main')");
      const insertPatch = source.workspace.prepare("INSERT INTO sync_log VALUES(?,'main')");
      source.workspace.exec("BEGIN");
      for (let index = 0; index < 5_000; index++) {
        const id = `issue-${index}`;
        insertIssue.run(id, index + 1, "2026-10-30T00:00:00Z", state.mirror, id);
        insertContent.run(id, id, state.mirror, state.contentState);
        insertEvent.run(index + 1);
        insertPatch.run(index + 1);
      }
      source.workspace.exec("COMMIT");
      let sourceReads = 0;
      const receipt = await createBackup(
        nodeSqliteDriver(source.workspace),
        {
          ACCOUNTS: directory(source.accounts),
          BACKUPS: bucket.binding(),
          DOCUMENTS: {
            getByName: () => ({
              snapshot: async () => {
                sourceReads++;
                return state;
              },
              restoreSnapshot: async () => "",
            }),
          },
        },
        "fixture-workspace",
      );
      expect(sourceReads).toBe(5_000);
      const restored = new Set<string>();
      let targetCalls = 0;
      const env = {
        ACCOUNTS: directory(target.accounts),
        BACKUPS: bucket.binding(),
        BACKUP_RESTORE_ISOLATED: "true",
        DOCUMENTS: {
          getByName: (name: string) => {
            targetCalls++;
            return {
              snapshot: async () => {
                throw new Error("Redundant target body probe");
              },
              restoreSnapshot: async (_workspace: string, issueId: string, incarnation: string, body: typeof state) => {
                expect(name).toBe(JSON.stringify(["fixture-workspace", issueId, incarnation]));
                if (restored.has(name)) throw new Error("Body target is not empty");
                restored.add(name);
                return body.contentState;
              },
            };
          },
        },
      };
      const bundle = await prepareRestore(nodeSqliteDriver(target.workspace), env, "fixture-workspace", receipt.key);
      expect(targetCalls).toBe(0);
      await applyRestore(nodeSqliteDriver(target.workspace), env, "fixture-workspace", bundle);
      expect(targetCalls).toBe(5_000);
      expect(restored.size).toBe(5_000);
      expect(target.workspace.prepare("SELECT COUNT(*) AS count FROM issue").get()?.["count"]).toBe(5_000);
    } finally {
      doc.destroy();
      source.close();
      target.close();
    }
  }, 30_000);
});
