import { models, type ActorType, type ModelName } from "@kanbun/model";
import type { SqlDriver } from "./driver";

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
  branchId?: string;
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

export function scopeOf(model: ModelName, row: Record<string, unknown>): [string | null, string | null] {
  const def = models[model];
  return [
    def.teamColumn ? ((row[def.teamColumn] as string | null) ?? null) : null,
    def.policy.kind === "perUser" ? ((row[def.policy.userColumn] as string | null) ?? null) : null,
  ];
}

/** Change capture is shared by main-table writes and durable overlay writes. */
export function recordChange(
  driver: SqlDriver,
  tag: LogTag,
  change: {
    model: ModelName;
    rowId: string;
    op: "upsert" | "delete";
    patch: Record<string, unknown> | null;
    prev: Record<string, unknown> | null;
    scopeRow: Record<string, unknown>;
    beforeRow: Record<string, unknown> | null;
  },
): void {
  const { model, rowId, op, patch, prev, scopeRow, beforeRow } = change;
  const [teamId, scopeUserId] = scopeOf(model, scopeRow);
  const prevTeam = beforeRow ? scopeOf(model, beforeRow)[0] : null;
  const prevTeamId = prevTeam !== null && prevTeam !== teamId ? prevTeam : null;
  driver.run(
    `INSERT INTO sync_log (model, row_id, op, patch, prev, actor_id, actor_type, client_id, mutation_id, txn_id, causation_seq, reason, team_id, prev_team_id, scope_user_id, ts, event_seq, branch_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      model,
      rowId,
      op,
      patch ? JSON.stringify(patch) : null,
      prev ? JSON.stringify(prev) : null,
      tag.actorId,
      tag.actorType,
      tag.clientId,
      tag.mutationId,
      tag.txnId,
      tag.causationSeq,
      tag.reason,
      teamId,
      prevTeamId,
      scopeUserId,
      tag.ts ?? new Date().toISOString(),
      tag.eventSeq ?? null,
      tag.branchId ?? "main",
    ],
  );
}

export function pick(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = row[key] ?? null;
  return out;
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return (a ?? null) === (b ?? null);
  if (typeof a === "object" && typeof b === "object" && a && b) return JSON.stringify(a) === JSON.stringify(b);
  return false;
}
