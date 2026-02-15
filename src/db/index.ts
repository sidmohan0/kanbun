import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { applySchema } from "./schema.js";

export function getDb(dbPath?: string): Database.Database {
  const resolvedPath =
    dbPath ?? path.join(process.cwd(), "data", "kanbun.db");
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applySchema(db);
  return db;
}
