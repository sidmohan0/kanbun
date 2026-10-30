import type { ModelName, Row } from "@kanbun/model";
import { normalizePatch, normalizeRow } from "../rows";
import { extremeOf, matches, type Patch, type Store, type Where } from "../store";
import { pick, recordChange, sameValue, scopeOf, SYSTEM_TAG, type LogTag } from "./changeLog";
import type { SqlDriver } from "./driver";
import { SqliteStore } from "./sqliteStore";

/** Durable copy-on-write rows over live main. Main projection tables are read-only here. */
export class SqliteBranchStore implements Store {
  private readonly main: SqliteStore;
  private readonly tag: LogTag;

  constructor(
    readonly driver: SqlDriver,
    readonly branchId: string,
    tag: LogTag = SYSTEM_TAG("branch"),
  ) {
    if (!branchId || branchId === "main") throw new Error("A durable overlay requires a non-main branch");
    this.main = new SqliteStore(driver);
    this.tag = { ...tag, branchId };
  }

  withTag(tag: LogTag): SqliteBranchStore {
    return new SqliteBranchStore(this.driver, this.branchId, tag);
  }

  hasOverlay(model: ModelName, id: string): boolean {
    return (
      this.driver.all("SELECT 1 FROM branch_row WHERE branch_id = ? AND entity_type = ? AND entity_id = ? LIMIT 1", [
        this.branchId,
        model,
        id,
      ]).length > 0
    );
  }

  get<M extends ModelName>(model: M, id: string): Row<M> | undefined {
    const overlay = this.driver.all(
      'SELECT "row", tombstone FROM branch_row WHERE branch_id = ? AND entity_type = ? AND entity_id = ? LIMIT 1',
      [this.branchId, model, id],
    )[0];
    if (!overlay) return this.main.get(model, id);
    if (overlay["tombstone"]) return undefined;
    return JSON.parse(String(overlay["row"])) as Row<M>;
  }

  list<M extends ModelName>(model: M, where?: Where<M>): Row<M>[] {
    const rows = new Map(this.main.list(model).map((row) => [row.id, row]));
    for (const overlay of this.driver.all(
      'SELECT entity_id, "row", tombstone FROM branch_row WHERE branch_id = ? AND entity_type = ?',
      [this.branchId, model],
    )) {
      const id = String(overlay["entity_id"]);
      if (overlay["tombstone"]) rows.delete(id);
      else rows.set(id, JSON.parse(String(overlay["row"])) as Row<M>);
    }
    return [...rows.values()].filter((row) => matches(row, where));
  }

  maxOf<M extends ModelName, K extends keyof Row<M>>(model: M, column: K, where?: Where<M>) {
    return extremeOf(this.list(model, where), column, "max");
  }

  minOf<M extends ModelName, K extends keyof Row<M>>(model: M, column: K, where?: Where<M>) {
    return extremeOf(this.list(model, where), column, "min");
  }

  insert<M extends ModelName>(model: M, row: Row<M>): void {
    const full = normalizeRow(model, row as Record<string, unknown>);
    const id = full["id"] as string;
    if (this.get(model, id)) throw new Error(`insert: ${model}/${id} already exists`);
    this.write(model, id, full);
    recordChange(this.driver, this.tag, {
      model,
      rowId: id,
      op: "upsert",
      patch: full,
      prev: null,
      scopeRow: full,
      beforeRow: null,
    });
  }

  put<M extends ModelName>(model: M, row: Row<M>): void {
    const full = normalizeRow(model, row as Record<string, unknown>);
    const id = full["id"] as string;
    const before = this.get(model, id) as Record<string, unknown> | undefined;
    this.write(model, id, full);
    recordChange(this.driver, this.tag, {
      model,
      rowId: id,
      op: "upsert",
      patch: full,
      prev: before ? pick(before, Object.keys(full)) : null,
      scopeRow: full,
      beforeRow: before ?? null,
    });
  }

  patch<M extends ModelName>(model: M, id: string, patch: Patch<M>): void {
    const normalized = normalizePatch(model, patch as Record<string, unknown>);
    if (!Object.keys(normalized).length) return;
    const before = this.get(model, id) as Record<string, unknown> | undefined;
    if (!before) throw new Error(`patch: ${model}/${id} not found`);
    const changed = Object.fromEntries(
      Object.entries(normalized).filter(([key, value]) => !sameValue(before[key], value)),
    );
    const keys = Object.keys(changed);
    if (!keys.length) return;
    const firstTouch = !this.hasOverlay(model, id);
    const after = { ...before, ...changed };
    const moved = scopeOf(model, before).some((value, index) => value !== scopeOf(model, after)[index]);
    this.write(model, id, after);
    recordChange(this.driver, this.tag, {
      model,
      rowId: id,
      op: "upsert",
      patch: firstTouch || moved ? after : changed,
      prev: pick(before, keys),
      scopeRow: after,
      beforeRow: before,
    });
  }

  delete<M extends ModelName>(model: M, id: string): void {
    const before = this.get(model, id) as Record<string, unknown> | undefined;
    if (!before) return;
    this.write(model, id, null);
    recordChange(this.driver, this.tag, {
      model,
      rowId: id,
      op: "delete",
      patch: null,
      prev: before,
      scopeRow: before,
      beforeRow: null,
    });
  }

  private write(model: ModelName, id: string, row: Record<string, unknown> | null): void {
    this.driver.run(
      `INSERT INTO branch_row (branch_id, entity_type, entity_id, "row", tombstone) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(branch_id, entity_type, entity_id) DO UPDATE SET "row" = excluded."row", tombstone = excluded.tombstone`,
      [this.branchId, model, id, row === null ? null : JSON.stringify(row), row === null ? 1 : 0],
    );
  }
}
