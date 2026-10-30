/**
 * Minimal synchronous SQL driver. Implemented over DO SQLite in the Worker
 * and over node:sqlite in tests. Both are synchronous, which is what lets
 * mutators be plain functions.
 *
 * Transaction control never goes through `run()`: DO SQLite refuses
 * BEGIN/SAVEPOINT statements from `sql.exec`, so each driver exposes the two
 * shapes the engine needs and implements them natively.
 */
export type SqlValue = string | number | null | Uint8Array;
export type SqlRow = Record<string, SqlValue>;

export interface SqlDriver {
  all(sql: string, params?: SqlValue[]): SqlRow[];
  run(sql: string, params?: SqlValue[]): void;
  /** Atomic unit of work. Calling it inside another `transaction` joins the outer one. */
  transaction<T>(fn: () => T): T;
  /**
   * A nested unit of work inside a `transaction`: if `fn` throws, only the
   * writes made inside it are undone and the error is rethrown; the outer
   * transaction continues. Used to isolate each mutation of a push.
   */
  savepoint<T>(fn: () => T): T;
}

/**
 * Driver over Cloudflare Durable Object SQLite (`ctx.storage.sql`).
 * `transactionSync` nests: workerd implements an inner call as
 * `SAVEPOINT _cf_sync_savepoint_<depth>` and rolls back to it when the
 * callback throws (src/workerd/api/actor-state.c++), which is exactly the
 * savepoint contract above.
 */
export function durableObjectDriver(storage: {
  sql: { exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] } };
  transactionSync<T>(fn: () => T): T;
}): SqlDriver {
  return {
    all(sql, params = []) {
      return storage.sql.exec(sql, ...params).toArray() as SqlRow[];
    },
    run(sql, params = []) {
      storage.sql.exec(sql, ...params);
    },
    transaction(fn) {
      return storage.transactionSync(fn);
    },
    savepoint(fn) {
      return storage.transactionSync(fn);
    },
  };
}

/** Driver over node:sqlite's DatabaseSync, for tests and the seed CLI. */
export function nodeSqliteDriver(db: {
  prepare(sql: string): { all(...params: SqlValue[]): unknown[]; run(...params: SqlValue[]): unknown };
  exec(sql: string): void;
}): SqlDriver {
  let depth = 0;
  let savepoints = 0;
  return {
    all(sql, params = []) {
      return db.prepare(sql).all(...params) as SqlRow[];
    },
    run(sql, params = []) {
      db.prepare(sql).run(...params);
    },
    transaction(fn) {
      if (depth > 0) return fn();
      depth++;
      db.exec("BEGIN");
      try {
        const out = fn();
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      } finally {
        depth--;
      }
    },
    savepoint(fn) {
      const name = `sp${savepoints++}`;
      db.exec(`SAVEPOINT ${name}`);
      try {
        const out = fn();
        db.exec(`RELEASE ${name}`);
        return out;
      } catch (e) {
        db.exec(`ROLLBACK TO ${name}`);
        db.exec(`RELEASE ${name}`);
        throw e;
      }
    },
  };
}

/** Apply a drizzle-kit migration journal (the `migrations.js` default export). */
export function applyMigrations(
  driver: SqlDriver,
  bundle: { journal: { entries: { idx: number; tag: string }[] }; migrations: Record<string, string> },
): void {
  driver.run(`CREATE TABLE IF NOT EXISTS __migrations (tag TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(driver.all(`SELECT tag FROM __migrations`).map((r) => r["tag"] as string));
  for (const entry of bundle.journal.entries) {
    if (applied.has(entry.tag)) continue;
    const key = `m${String(entry.idx).padStart(4, "0")}`;
    const sql = bundle.migrations[key];
    if (!sql) throw new Error(`migration ${key} missing from bundle`);
    driver.transaction(() => {
      for (const stmt of sql.split("--> statement-breakpoint")) {
        const s = stmt.trim();
        if (s) driver.run(s);
      }
      driver.run(`INSERT INTO __migrations (tag, applied_at) VALUES (?, ?)`, [entry.tag, new Date().toISOString()]);
    });
  }
}
