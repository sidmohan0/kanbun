/**
 * Store over SQLite. Every write is also appended to sync_log, tagged with
 * the mutation that caused it and the row's permission scope (team, user).
 */
import { models, type ActorType, type ModelName, type Row } from "@kanbun/model";
import { extremeOf, matches, type Patch, type Store, type Where } from "../store";
import { fromSql, normalizePatch, normalizeRow, tableMeta, toSql, type TableMeta } from "../rows";
import type { SqlDriver, SqlRow, SqlValue } from "./driver";

export type LogTag = {
  actorId: string | null;
  actorType: ActorType;
  clientId: string | null;
  mutationId: number | null;
  txnId: string;
  causationSeq: number | null;
  reason: string | null;
  /** Present for patches derived from a committed semantic event. */
  eventSeq?: number;
  ts?: string;
};

export const SYSTEM_TAG = (txnId: string): LogTag => ({
  actorId: null,
  actorType: "system",
  clientId: null,
  mutationId: null,
  txnId,
  causationSeq: null,
  reason: null,
});

const q = (ident: string) => `"${ident}"`;

export class SqliteStore implements Store {
  /** Set true while a server-side mutation runs so writes are logged. */
  constructor(
    readonly driver: SqlDriver,
    private tag: LogTag = SYSTEM_TAG("boot"),
  ) {}

  withTag(tag: LogTag): SqliteStore {
    return new SqliteStore(this.driver, tag);
  }

  private decode(meta: TableMeta, r: SqlRow): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const c of meta.columns) out[c.key] = fromSql(c, r[c.name]);
    return out;
  }

  get<M extends ModelName>(model: M, id: string): Row<M> | undefined {
    const meta = tableMeta(model);
    const rows = this.driver.all(`SELECT * FROM ${q(meta.tableName)} WHERE id = ? LIMIT 1`, [id]);
    const r = rows[0];
    return r ? (this.decode(meta, r) as Row<M>) : undefined;
  }

  list<M extends ModelName>(model: M, where?: Where<M>): Row<M>[] {
    const meta = tableMeta(model);
    const { clauses, params, residual } = this.whereSql(meta, where);
    const sql = `SELECT * FROM ${q(meta.tableName)}${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""}`;
    const rows = this.driver.all(sql, params).map((r) => this.decode(meta, r) as Row<M>);
    return Object.keys(residual).length ? rows.filter((r) => matches(r, residual as Where<M>)) : rows;
  }

  maxOf<M extends ModelName, K extends keyof Row<M>>(model: M, column: K, where?: Where<M>) {
    return this.extreme(model, column, where, "MAX");
  }
  minOf<M extends ModelName, K extends keyof Row<M>>(model: M, column: K, where?: Where<M>) {
    return this.extreme(model, column, where, "MIN");
  }

  private extreme<M extends ModelName, K extends keyof Row<M>>(
    model: M,
    column: K,
    where: Where<M> | undefined,
    fn: "MAX" | "MIN",
  ): Row<M>[K] | undefined {
    const meta = tableMeta(model);
    const col = meta.byKey.get(column as string);
    if (!col) throw new Error(`${model}.${String(column)} is not a column`);
    const { clauses, params, residual } = this.whereSql(meta, where);
    if (Object.keys(residual).length) return extremeOf(this.list(model, where), column, fn === "MAX" ? "max" : "min");
    const r = this.driver.all(
      `SELECT ${fn}(${q(col.name)}) AS v FROM ${q(meta.tableName)}${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""}`,
      params,
    )[0];
    const v = r?.["v"];
    return v === null || v === undefined ? undefined : (fromSql(col, v) as Row<M>[K]);
  }

  private whereSql<M extends ModelName>(meta: TableMeta, where: Where<M> | undefined) {
    const clauses: string[] = [];
    const params: SqlValue[] = [];
    const residual: Record<string, unknown> = {};
    if (where) {
      for (const [k, v] of Object.entries(where)) {
        if (v === undefined) continue;
        const c = meta.byKey.get(k);
        if (!c) continue;
        if (c.dataType === "json") {
          residual[k] = v;
          continue;
        }
        if (v === null) clauses.push(`${q(c.name)} IS NULL`);
        else {
          clauses.push(`${q(c.name)} = ?`);
          params.push(toSql(c, v));
        }
      }
    }
    return { clauses, params, residual };
  }

  /** Raw query escape hatch for the server (bootstrap, pull filters). */
  rawList<M extends ModelName>(model: M, whereSql: string, params: SqlValue[] = []): Row<M>[] {
    const meta = tableMeta(model);
    return this.driver
      .all(`SELECT * FROM ${q(meta.tableName)}${whereSql ? ` WHERE ${whereSql}` : ""}`, params)
      .map((r) => this.decode(meta, r) as Row<M>);
  }

  insert<M extends ModelName>(model: M, row: Row<M>): void {
    const meta = tableMeta(model);
    const full = normalizeRow(model, row as Record<string, unknown>);
    const id = full["id"] as string;
    if (this.get(model, id)) throw new Error(`insert: ${model}/${id} already exists`);
    const cols = meta.columns.map((c) => q(c.name)).join(", ");
    const marks = meta.columns.map(() => "?").join(", ");
    this.driver.run(
      `INSERT INTO ${q(meta.tableName)} (${cols}) VALUES (${marks})`,
      meta.columns.map((c) => toSql(c, full[c.key])),
    );
    this.log(model, id, "upsert", full, null, full, null);
  }

  put<M extends ModelName>(model: M, row: Row<M>): void {
    const meta = tableMeta(model);
    const full = normalizeRow(model, row as Record<string, unknown>);
    const before = this.get(model, full["id"] as string) as Record<string, unknown> | undefined;
    const cols = meta.columns.map((c) => q(c.name)).join(", ");
    const marks = meta.columns.map(() => "?").join(", ");
    const updates = meta.columns
      .filter((c) => c.key !== "id")
      .map((c) => `${q(c.name)} = excluded.${q(c.name)}`)
      .join(", ");
    this.driver.run(
      `INSERT INTO ${q(meta.tableName)} (${cols}) VALUES (${marks}) ON CONFLICT(id) DO UPDATE SET ${updates}`,
      meta.columns.map((c) => toSql(c, full[c.key])),
    );
    this.log(
      model,
      full["id"] as string,
      "upsert",
      full,
      before ? pick(before, Object.keys(full)) : null,
      full,
      before ?? null,
    );
  }

  patch<M extends ModelName>(model: M, id: string, patch: Patch<M>): void {
    const meta = tableMeta(model);
    const p = normalizePatch(model, patch as Record<string, unknown>);
    const keys = Object.keys(p);
    if (keys.length === 0) return;
    const before = this.get(model, id) as Record<string, unknown> | undefined;
    if (!before) throw new Error(`patch: ${model}/${id} not found`);
    // Only log what actually changed.
    const changed: Record<string, unknown> = {};
    for (const k of keys) if (!sameValue(before[k], p[k])) changed[k] = p[k];
    const ck = Object.keys(changed);
    if (ck.length === 0) return;
    const sets = ck.map((k) => `${q(meta.byKey.get(k)!.name)} = ?`).join(", ");
    const params = ck.map((k) => toSql(meta.byKey.get(k)!, changed[k]));
    this.driver.run(`UPDATE ${q(meta.tableName)} SET ${sets} WHERE id = ?`, [...params, id]);
    const after = { ...before, ...changed };
    // A write that moves the row into another scope is logged as the whole row:
    // viewers of the new scope may never have seen it, and a field-grain patch
    // would leave them with a fragment.
    const moved = this.scopeOf(model, before).some((v, i) => v !== this.scopeOf(model, after)[i]);
    this.log(model, id, "upsert", moved ? after : changed, pick(before, ck), after, before);
  }

  private scopeOf(model: ModelName, row: Record<string, unknown>): [string | null, string | null] {
    const def = models[model];
    return [
      def.teamColumn ? ((row[def.teamColumn] as string | null) ?? null) : null,
      def.policy.kind === "perUser" ? ((row[def.policy.userColumn] as string | null) ?? null) : null,
    ];
  }

  delete<M extends ModelName>(model: M, id: string): void {
    const meta = tableMeta(model);
    const before = this.get(model, id);
    this.driver.run(`DELETE FROM ${q(meta.tableName)} WHERE id = ?`, [id]);
    if (before)
      this.log(model, id, "delete", null, before as Record<string, unknown>, before as Record<string, unknown>, null);
  }

  private log(
    model: ModelName,
    rowId: string,
    op: "upsert" | "delete",
    patch: Record<string, unknown> | null,
    prev: Record<string, unknown> | null,
    scopeRow: Record<string, unknown>,
    beforeRow: Record<string, unknown> | null,
  ): void {
    const [teamId, scopeUserId] = this.scopeOf(model, scopeRow);
    const prevTeam = beforeRow ? this.scopeOf(model, beforeRow)[0] : null;
    const prevTeamId = prevTeam !== null && prevTeam !== teamId ? prevTeam : null;
    this.driver.run(
      `INSERT INTO sync_log (model, row_id, op, patch, prev, actor_id, actor_type, client_id, mutation_id, txn_id, causation_seq, reason, team_id, prev_team_id, scope_user_id, ts, event_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        model,
        rowId,
        op,
        patch ? JSON.stringify(patch) : null,
        prev ? JSON.stringify(prev) : null,
        this.tag.actorId,
        this.tag.actorType,
        this.tag.clientId,
        this.tag.mutationId,
        this.tag.txnId,
        this.tag.causationSeq,
        this.tag.reason,
        teamId,
        prevTeamId,
        scopeUserId,
        this.tag.ts ?? new Date().toISOString(),
        this.tag.eventSeq ?? null,
      ],
    );
  }
}

function pick(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = row[k] ?? null;
  return out;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return (a ?? null) === (b ?? null);
  if (typeof a === "object" && typeof b === "object" && a && b) return JSON.stringify(a) === JSON.stringify(b);
  return false;
}
