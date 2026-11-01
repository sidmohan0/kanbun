import type { SqlDriver, SqlValue } from "@kanbun/sync/server";
import { z } from "zod";
import type { D1Database } from "@cloudflare/workers-types";

const cell = z.union([z.null(), z.string(), z.number().finite(), z.strictObject({ binary: z.string() })]);
export const databaseSnapshotSchema = z.strictObject({
  schema: z.array(z.strictObject({ type: z.string(), name: z.string(), table: z.string(), sql: z.string() })),
  tables: z.array(z.strictObject({ name: z.string(), columns: z.array(z.string()), rows: z.array(z.array(cell)) })),
});
export type DatabaseSnapshot = z.infer<typeof databaseSnapshotSchema>;

const schemaQuery = "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type, name";
const identifier = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const applicationTable = (name: string) =>
  !name.startsWith("sqlite_") &&
  !name.startsWith("__cf_") &&
  !name.startsWith("_cf_") &&
  !name.startsWith("__miniflare_");

function encoded(value: unknown): z.infer<typeof cell> {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer || Array.isArray(value)) {
    const bytes =
      value instanceof Uint8Array
        ? value
        : value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : Uint8Array.from(value as number[]);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { binary: btoa(binary) };
  }
  return cell.parse(value);
}
function decoded(value: z.infer<typeof cell>): SqlValue {
  if (value !== null && typeof value === "object") {
    const binary = atob(value.binary);
    if (btoa(binary) !== value.binary) throw new Error("Invalid backup binary encoding");
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  return value;
}
function schemaRows(rows: Record<string, unknown>[]) {
  return rows
    .filter((row) => applicationTable(String(row["tbl_name"])))
    .map((row) => ({
      type: String(row["type"]),
      name: String(row["name"]),
      table: String(row["tbl_name"]),
      sql: String(row["sql"]),
    }));
}
function snapshotTable(name: string, columns: string[], rows: Record<string, unknown>[]) {
  if (name === "sqlite_sequence") rows = rows.filter((row) => applicationTable(String(row["name"])));
  return {
    name,
    columns,
    rows: rows
      .map((row) => columns.map((column) => encoded(row[column])))
      .sort((left, right) => {
        const a = JSON.stringify(left),
          b = JSON.stringify(right);
        return a < b ? -1 : a > b ? 1 : 0;
      }),
  };
}

/** Includes engine tables and AUTOINCREMENT high-watermarks, not only model projections. */
export function captureSqlite(driver: SqlDriver): DatabaseSnapshot {
  return driver.transaction(() => {
    const schema = schemaRows(driver.all(schemaQuery));
    const names = schema
      .filter((entry) => entry.type === "table")
      .map((entry) => entry.name)
      .sort();
    if (driver.all("SELECT name FROM sqlite_schema WHERE name = 'sqlite_sequence'").length)
      names.push("sqlite_sequence");
    return {
      schema,
      tables: names.map((name) =>
        snapshotTable(
          name,
          driver.all(`PRAGMA table_info(${identifier(name)})`).map((column) => String(column["name"])),
          driver.all(`SELECT * FROM ${identifier(name)}`),
        ),
      ),
    };
  });
}

/** D1 batch queries run atomically; schema discovery is checked inside that same batch. */
export async function captureDirectory(database: D1Database): Promise<DatabaseSnapshot> {
  const discovered = schemaRows((await database.prepare(schemaQuery).all()).results);
  const names = discovered
    .filter((entry) => entry.type === "table")
    .map((entry) => entry.name)
    .sort();
  if ((await database.prepare("SELECT name FROM sqlite_schema WHERE name = 'sqlite_sequence'").all()).results.length)
    names.push("sqlite_sequence");
  const results = await database.batch<Record<string, unknown>>([
    database.prepare(schemaQuery),
    ...names.flatMap((name) => [
      database.prepare(`PRAGMA table_info(${identifier(name)})`),
      database.prepare(`SELECT * FROM ${identifier(name)}`),
    ]),
  ]);
  const schema = schemaRows(results[0]!.results);
  if (JSON.stringify(schema) !== JSON.stringify(discovered)) throw new Error("Directory schema changed during backup");
  return {
    schema,
    tables: names.map((name, index) =>
      snapshotTable(
        name,
        results[index * 2 + 1]!.results.map((column) => String(column["name"])),
        results[index * 2 + 2]!.results,
      ),
    ),
  };
}

/** Archive SQL is never executed. Targets must already have the identical migrated schema. */
export function validateRestore(source: DatabaseSnapshot, target: DatabaseSnapshot, migrationTable: string): void {
  databaseSnapshotSchema.parse(source);
  if (JSON.stringify(source.schema) !== JSON.stringify(target.schema))
    throw new Error("Backup schema does not match the target code");
  if (
    new Set(source.tables.map((table) => table.name)).size !== source.tables.length ||
    JSON.stringify(source.tables.map((table) => table.name).sort()) !==
      JSON.stringify(target.tables.map((table) => table.name).sort())
  )
    throw new Error("Backup table inventory does not match target");
  for (const table of source.tables) {
    const existing = target.tables.find((entry) => entry.name === table.name);
    if (!existing || JSON.stringify(existing.columns) !== JSON.stringify(table.columns))
      throw new Error("Backup columns do not match target");
    if (existing.rows.length && table.name !== migrationTable && table.name !== "sqlite_sequence")
      throw new Error(`Restore target is not empty: ${table.name}`);
    for (const row of table.rows) {
      if (row.length !== table.columns.length) throw new Error("Backup row does not match target columns");
      for (const value of row) decoded(value);
    }
  }
  // Counters may exist only for the migrations already applied to the fresh target.
  const counters = target.tables.find((table) => table.name === "sqlite_sequence");
  if (counters?.rows.some((row) => row[0] !== migrationTable && Number(row[1]) > 0))
    throw new Error("Restore target has existing application counters");
}

function deleteTable(table: string, snapshot: DatabaseSnapshot) {
  if (table !== "sqlite_sequence") return `DELETE FROM ${identifier(table)}`;
  // Internal backend counters belong to the target namespace and must remain untouched.
  const names = snapshot.schema
    .filter((entry) => entry.type === "table")
    .map((entry) => "'" + entry.name.replaceAll("'", "''") + "'");
  return `DELETE FROM sqlite_sequence WHERE name IN (${names.join(",")})`;
}

export function restoreSqlite(driver: SqlDriver, source: DatabaseSnapshot): void {
  validateRestore(source, captureSqlite(driver), "__migrations");
  driver.transaction(() => {
    for (const table of source.tables) {
      driver.run(deleteTable(table.name, source));
      for (const row of table.rows)
        driver.run(
          `INSERT INTO ${identifier(table.name)} (${table.columns.map(identifier).join(",")}) VALUES (${table.columns.map(() => "?").join(",")})`,
          row.map(decoded),
        );
    }
  });
}

/** Restore durable identities and admission, never reusable sign-in credentials.
 * The complete source snapshot is still hash/schema validated before this policy is applied.
 */
export async function restoreDirectory(database: D1Database, source: DatabaseSnapshot): Promise<void> {
  validateRestore(source, await captureDirectory(database), "d1_migrations");
  // The guard executes in the same transaction as import, closing admission races after preflight.
  const occupied = source.tables
    .filter((table) => table.name !== "d1_migrations" && table.name !== "sqlite_sequence")
    .map((table) => `EXISTS(SELECT 1 FROM ${identifier(table.name)})`);
  if (source.tables.some((table) => table.name === "sqlite_sequence"))
    occupied.push(
      "EXISTS(SELECT 1 FROM sqlite_sequence WHERE name <> 'd1_migrations' AND seq > 0 AND name NOT GLOB '__miniflare_*' AND name NOT GLOB '__cf_*' AND name NOT GLOB '_cf_*')",
    );
  const statements = [
    database.prepare(
      `SELECT CASE WHEN ${occupied.join(" OR ") || "0"} THEN json('restore target is not empty') ELSE 1 END AS empty_target`,
    ),
    ...source.tables.flatMap((table) => [
      database.prepare(deleteTable(table.name, source)),
      // A historical cookie, link, or session-bound OAuth setup must not revive after a restore.
      // Keep these tables in the validated inventory, but leave them empty in the
      // same atomic transaction that imports accounts, identities and membership.
      ...(["sessions", "magic_links", "oauth_states", "github_setups", "slack_connections"].includes(table.name)
        ? []
        : table.rows
      ).map((row) =>
        database
          .prepare(
            `INSERT INTO ${identifier(table.name)} (${table.columns.map(identifier).join(",")}) VALUES (${table.columns.map(() => "?").join(",")})`,
          )
          .bind(...row.map(decoded)),
      ),
    ]),
  ];
  await database.batch(statements);
}
