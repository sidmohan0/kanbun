import { eventSchema, type DomainEvent, type PendingEvent } from "@kanbun/events";
import type { Actor } from "../mutators";
import type { SqlDriver, SqlRow } from "./driver";

export type EventProvenance = {
  actor: Actor;
  txnId: string;
  eventIndex: number;
  clientId: string | null;
  mutationId: number | null;
  ts: number;
  causationSeq: number | null;
  reason: string | null;
  branchId?: string;
  sourceRef?: string;
};

/** Called inside the same savepoint as reducer application and change capture. */
export function appendEvent(driver: SqlDriver, pending: PendingEvent, provenance: EventProvenance): DomainEvent {
  const event = eventSchema.parse({
    ...pending,
    ...provenance,
    seq: 0,
    branchId: provenance.branchId ?? "main",
    sessionId: null,
    sourceRef: provenance.sourceRef ?? null,
  });
  if (event.type === "IssueCreated" && event.branchId === "main" && event.payload.number === 0)
    throw new Error("Committed issue creation requires an authoritative issue number");
  if (event.type === "IssueCreated" && event.branchId !== "main" && event.payload.number !== 0)
    throw new Error("Branch issue creation cannot allocate an issue number");
  driver.run(
    `INSERT INTO event_log
      (branch_id, txn_id, event_index, type, entity_type, entity_id, team_id, scope_user_id,
       payload, actor, client_id, mutation_id, session_id, source_ref, causation_seq, reason, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.branchId,
      event.txnId,
      event.eventIndex,
      event.type,
      event.entityType,
      event.entityId,
      event.teamId,
      event.scopeUserId,
      JSON.stringify(event.payload),
      JSON.stringify(event.actor),
      event.clientId,
      event.mutationId,
      event.sessionId,
      event.sourceRef,
      event.causationSeq,
      event.reason,
      event.ts,
    ],
  );
  const seq = Number(driver.all("SELECT last_insert_rowid() AS seq")[0]?.["seq"]);
  if (!Number.isSafeInteger(seq) || seq <= 0) throw new Error("Could not assign a committed event sequence");
  return { ...event, seq };
}

export function decodeEvent(row: SqlRow): DomainEvent {
  return eventSchema.parse({
    seq: row["seq"],
    branchId: row["branch_id"],
    txnId: row["txn_id"],
    eventIndex: row["event_index"],
    type: row["type"],
    entityType: row["entity_type"],
    entityId: row["entity_id"],
    teamId: row["team_id"],
    scopeUserId: row["scope_user_id"],
    payload: JSON.parse(String(row["payload"])),
    actor: JSON.parse(String(row["actor"])),
    clientId: row["client_id"],
    mutationId: row["mutation_id"],
    sessionId: row["session_id"],
    sourceRef: row["source_ref"],
    causationSeq: row["causation_seq"],
    reason: row["reason"],
    ts: row["ts"],
  });
}
