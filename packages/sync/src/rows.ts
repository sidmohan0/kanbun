/**
 * Row normalisation shared by client and server, driven by the drizzle
 * column metadata in the model registry. Applying defaults here (not in
 * the database) keeps the optimistic row and the authoritative row equal.
 */
import { getTableColumns, getTableName } from "drizzle-orm";
import { models, type ModelName } from "@kanbun/model";

export type ColumnMeta = {
  key: string;
  name: string;
  dataType: string;
  notNull: boolean;
  hasDefault: boolean;
  default: unknown;
  defaultFn: (() => unknown) | undefined;
};

export type TableMeta = {
  model: ModelName;
  tableName: string;
  columns: ColumnMeta[];
  byKey: Map<string, ColumnMeta>;
  byName: Map<string, ColumnMeta>;
};

const cache = new Map<ModelName, TableMeta>();

export function tableMeta(model: ModelName): TableMeta {
  let m = cache.get(model);
  if (m) return m;
  const def = models[model];
  const cols = getTableColumns(def.table) as Record<
    string,
    {
      name: string;
      dataType: string;
      notNull: boolean;
      hasDefault: boolean;
      default: unknown;
      defaultFn?: () => unknown;
    }
  >;
  const columns: ColumnMeta[] = Object.entries(cols).map(([key, c]) => ({
    key,
    name: c.name,
    dataType: c.dataType,
    notNull: c.notNull,
    hasDefault: c.hasDefault,
    default: c.default,
    defaultFn: c.defaultFn,
  }));
  m = {
    model,
    tableName: getTableName(def.table),
    columns,
    byKey: new Map(columns.map((c) => [c.key, c])),
    byName: new Map(columns.map((c) => [c.name, c])),
  };
  cache.set(model, m);
  return m;
}

/** Fill defaults for missing columns and drop unknown keys. Throws on a missing NOT NULL. */
export function normalizeRow(model: ModelName, input: Record<string, unknown>): Record<string, unknown> {
  const meta = tableMeta(model);
  const out: Record<string, unknown> = {};
  for (const c of meta.columns) {
    let v = input[c.key];
    if (v === undefined) {
      if (c.defaultFn) v = c.defaultFn();
      else if (c.default !== undefined) v = c.default;
      else v = null;
    }
    if (v === null && c.notNull) throw new Error(`${model}.${c.key} is required`);
    out[c.key] = v;
  }
  return out;
}

/** Drop unknown keys from a patch; never fills defaults. */
export function normalizePatch(model: ModelName, patch: Record<string, unknown>): Record<string, unknown> {
  const meta = tableMeta(model);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (!meta.byKey.has(k)) continue;
    if (k === "id") continue;
    out[k] = v;
  }
  return out;
}

export function toSql(c: ColumnMeta, v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  switch (c.dataType) {
    case "boolean":
      return v ? 1 : 0;
    case "json":
      return JSON.stringify(v);
    case "number":
      return v as number;
    default:
      return String(v);
  }
}

export function fromSql(c: ColumnMeta, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (c.dataType) {
    case "boolean":
      return v === 1 || v === true;
    case "json":
      return typeof v === "string" ? JSON.parse(v) : v;
    default:
      return v;
  }
}
