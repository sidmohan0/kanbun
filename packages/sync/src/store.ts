/**
 * The Store interface every mutator is written against. The client
 * implements it over an in-memory object pool; the server over SQLite.
 * Both are synchronous: DO SQLite and the pool are synchronous, and a
 * synchronous mutator cannot interleave with another.
 */
import type { ModelName, Row } from "@kanbun/model";
import { normalizePatch, normalizeRow } from "./rows";

export type Where<M extends ModelName> = Partial<Row<M>>;
/** A partial update; `undefined` values are ignored (so Zod `.partial()` output is accepted as-is). */
export type Patch<M extends ModelName> = { [K in keyof Row<M>]?: Row<M>[K] | undefined };

export interface Store {
  get<M extends ModelName>(model: M, id: string): Row<M> | undefined;
  /** Equality filter on any columns; `undefined` values are ignored. */
  list<M extends ModelName>(model: M, where?: Where<M>): Row<M>[];
  /** Insert a new row; throws if a row with that id already exists. Creates use this. */
  insert<M extends ModelName>(model: M, row: Row<M>): void;
  /** Insert or fully replace. Only for rows the caller means to overwrite (settings, preferences). */
  put<M extends ModelName>(model: M, row: Row<M>): void;
  /** Partial update; throws if the row does not exist. */
  patch<M extends ModelName>(model: M, id: string, patch: Patch<M>): void;
  delete<M extends ModelName>(model: M, id: string): void;
  /** Largest / smallest value of one column among matching rows (string or number columns); undefined if none. */
  maxOf<M extends ModelName, K extends keyof Row<M>>(model: M, column: K, where?: Where<M>): Row<M>[K] | undefined;
  minOf<M extends ModelName, K extends keyof Row<M>>(model: M, column: K, where?: Where<M>): Row<M>[K] | undefined;
}

export function extremeOf<M extends ModelName, K extends keyof Row<M>>(
  rows: Iterable<Row<M>>,
  column: K,
  dir: "max" | "min",
): Row<M>[K] | undefined {
  let best: Row<M>[K] | undefined;
  for (const r of rows) {
    const v = r[column];
    if (v === null || v === undefined) continue;
    if (best === undefined || best === null || (dir === "max" ? v > best : v < best)) best = v;
  }
  return best;
}

export function matches<M extends ModelName>(row: Row<M>, where: Where<M> | undefined): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if ((row as Record<string, unknown>)[k] !== v) return false;
  }
  return true;
}

export type PoolChange = { model: ModelName; id: string; op: "upsert" | "delete" };

/** A store that can also enumerate its rows, so an overlay can stack on it. */
export interface ReadableStore extends Store {
  entries(model: ModelName): Iterable<[string, Record<string, unknown>]>;
}
export type PoolListener = (changes: PoolChange[]) => void;

/**
 * In-memory object pool: Map per model. Used as the canonical (server-confirmed)
 * state on the client and as a plain store in tests.
 */
export class MemoryStore implements ReadableStore {
  readonly tables = new Map<ModelName, Map<string, Record<string, unknown>>>();

  table(model: ModelName): Map<string, Record<string, unknown>> {
    let t = this.tables.get(model);
    if (!t) {
      t = new Map();
      this.tables.set(model, t);
    }
    return t;
  }

  entries(model: ModelName): Iterable<[string, Record<string, unknown>]> {
    return this.table(model).entries();
  }

  get<M extends ModelName>(model: M, id: string): Row<M> | undefined {
    return this.table(model).get(id) as Row<M> | undefined;
  }

  list<M extends ModelName>(model: M, where?: Where<M>): Row<M>[] {
    const out: Row<M>[] = [];
    for (const row of this.table(model).values()) {
      if (matches(row as Row<M>, where)) out.push(row as Row<M>);
    }
    return out;
  }

  insert<M extends ModelName>(model: M, row: Row<M>): void {
    const full = normalizeRow(model, row as Record<string, unknown>);
    if (this.table(model).has(full["id"] as string))
      throw new Error(`insert: ${model}/${String(full["id"])} already exists`);
    this.table(model).set(full["id"] as string, full);
  }

  put<M extends ModelName>(model: M, row: Row<M>): void {
    const full = normalizeRow(model, row as Record<string, unknown>);
    this.table(model).set(full["id"] as string, full);
  }

  patch<M extends ModelName>(model: M, id: string, patch: Patch<M>): void {
    const t = this.table(model);
    const cur = t.get(id);
    if (!cur) throw new Error(`patch: ${model}/${id} not found`);
    t.set(id, { ...cur, ...normalizePatch(model, patch as Record<string, unknown>) });
  }

  delete<M extends ModelName>(model: M, id: string): void {
    this.table(model).delete(id);
  }

  maxOf<M extends ModelName, K extends keyof Row<M>>(model: M, column: K, where?: Where<M>) {
    return extremeOf(this.list(model, where), column, "max");
  }
  minOf<M extends ModelName, K extends keyof Row<M>>(model: M, column: K, where?: Where<M>) {
    return extremeOf(this.list(model, where), column, "min");
  }

  /** Apply a raw upsert from the server log: insert or merge patch. */
  applyUpsert(model: ModelName, id: string, patch: Record<string, unknown>): void {
    const t = this.table(model);
    const cur = t.get(id);
    t.set(id, cur ? { ...cur, ...patch } : { ...patch });
  }
}

type Tombstone = { __deleted: true };
const TOMBSTONE: Tombstone = { __deleted: true };

/**
 * Copy-on-write overlay over any readable store. Writes land in the overlay;
 * reads check the overlay first. Overlays stack: the client's pending
 * mutations are one layer, and a proposal from an agent is another layer on
 * top, so "accept" is replaying that layer through the normal path.
 * Clearing a layer returns to its base, which is how the client rebases.
 */
export class OverlayStore implements ReadableStore {
  private overlay = new Map<ModelName, Map<string, Record<string, unknown> | Tombstone>>();

  constructor(readonly base: ReadableStore) {}

  private layer(model: ModelName) {
    let t = this.overlay.get(model);
    if (!t) {
      t = new Map();
      this.overlay.set(model, t);
    }
    return t;
  }

  clear(): void {
    this.overlay.clear();
  }

  /**
   * Copy another overlay's entries (tombstones included) into this one. Used to
   * run a mutation in a scratch overlay and keep its writes only if it succeeds.
   */
  absorb(other: OverlayStore): void {
    for (const [model, t] of other.overlay) {
      const mine = this.layer(model);
      for (const [id, v] of t) mine.set(id, v);
    }
  }

  /** Models + ids touched in the overlay, for change notification. */
  touched(): PoolChange[] {
    const out: PoolChange[] = [];
    for (const [model, t] of this.overlay) {
      for (const [id, v] of t) out.push({ model, id, op: "__deleted" in v ? "delete" : "upsert" });
    }
    return out;
  }

  get<M extends ModelName>(model: M, id: string): Row<M> | undefined {
    const o = this.overlay.get(model)?.get(id);
    if (o) return "__deleted" in o ? undefined : (o as Row<M>);
    return this.base.get(model, id);
  }

  *entries(model: ModelName): Iterable<[string, Record<string, unknown>]> {
    const layer = this.overlay.get(model);
    for (const [id, row] of this.base.entries(model)) {
      if (layer?.has(id)) continue;
      yield [id, row];
    }
    if (layer) {
      for (const [id, v] of layer) if (!("__deleted" in v)) yield [id, v];
    }
  }

  list<M extends ModelName>(model: M, where?: Where<M>): Row<M>[] {
    const out: Row<M>[] = [];
    for (const [, row] of this.entries(model)) if (matches(row as Row<M>, where)) out.push(row as Row<M>);
    return out;
  }

  insert<M extends ModelName>(model: M, row: Row<M>): void {
    const full = normalizeRow(model, row as Record<string, unknown>);
    if (this.get(model, full["id"] as string)) throw new Error(`insert: ${model}/${String(full["id"])} already exists`);
    this.layer(model).set(full["id"] as string, full);
  }

  put<M extends ModelName>(model: M, row: Row<M>): void {
    const full = normalizeRow(model, row as Record<string, unknown>);
    this.layer(model).set(full["id"] as string, full);
  }

  patch<M extends ModelName>(model: M, id: string, patch: Patch<M>): void {
    const cur = this.get(model, id);
    if (!cur) throw new Error(`patch: ${model}/${id} not found`);
    this.layer(model).set(id, {
      ...(cur as Record<string, unknown>),
      ...normalizePatch(model, patch as Record<string, unknown>),
    });
  }

  delete<M extends ModelName>(model: M, id: string): void {
    this.layer(model).set(id, TOMBSTONE);
  }

  maxOf<M extends ModelName, K extends keyof Row<M>>(model: M, column: K, where?: Where<M>) {
    return extremeOf(this.list(model, where), column, "max");
  }
  minOf<M extends ModelName, K extends keyof Row<M>>(model: M, column: K, where?: Where<M>) {
    return extremeOf(this.list(model, where), column, "min");
  }
}
