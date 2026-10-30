/**
 * Node-only helpers: a node:sqlite-backed driver with the workspace
 * migrations applied, for tests and the seed CLI. Not imported by the Worker.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { nodeSqliteDriver, applyMigrations, type SqlDriver } from "./driver";

const require = createRequire(import.meta.url);

export function loadMigrationBundle(which: "workspace" | "accounts") {
  const modelDir = dirname(require.resolve("@kanbun/model/package.json"));
  const dir = join(modelDir, "migrations", which);
  const journal = JSON.parse(readFileSync(join(dir, "meta", "_journal.json"), "utf8")) as {
    entries: { idx: number; tag: string }[];
  };
  const migrations: Record<string, string> = {};
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".sql")) continue;
    const idx = Number(f.slice(0, 4));
    migrations[`m${String(idx).padStart(4, "0")}`] = readFileSync(join(dir, f), "utf8");
  }
  return { journal, migrations };
}

export function openWorkspaceDb(path = ":memory:"): { db: DatabaseSync; driver: SqlDriver } {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const driver = nodeSqliteDriver(db);
  applyMigrations(driver, loadMigrationBundle("workspace"));
  return { db, driver };
}
