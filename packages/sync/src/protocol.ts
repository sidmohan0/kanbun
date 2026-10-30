/**
 * Wire protocol between the client store and the workspace Durable Object.
 * Replicache-shaped: mutations are pushed, log entries are pulled, a poke
 * over WebSocket says "there is something to pull".
 */
import type { ActorType, ModelName } from "@kanbun/model";

export type Mutation = {
  /** Monotonic per client, starting at 1. */
  id: number;
  name: string;
  args: unknown;
  /** Client wall-clock at creation; the server uses its own clock for rows. */
  ts: string;
  /** Why (mainly for agents). Stored on every log row the mutation writes. */
  reason?: string;
  /** Sync-log patch sequence this mutation responds to; not an event-log sequence. */
  causationSeq?: number;
};

export type PushRequest = {
  clientId: string;
  mutations: Mutation[];
};

export type PushRejected = { id: number; error: string };

export type PushResponse =
  | { ok: true; lastMutationId: number; seq: number; rejected: PushRejected[] }
  | { ok: false; error: string; code: "unauthorized" | "gap" | "internal" };

export type LogOp = "upsert" | "delete";

export type LogEntry = {
  seq: number;
  model: ModelName;
  id: string;
  op: LogOp;
  /** Changed fields for upserts (the full row for inserts); null for deletes. */
  patch: Record<string, unknown> | null;
};

/** A log entry with its provenance, as the activity feed reads it. */
export type ActivityEntry = LogEntry & {
  prev: Record<string, unknown> | null;
  actorId: string | null;
  actorType: ActorType;
  txnId: string;
  causationSeq: number | null;
  reason: string | null;
  ts: string;
};

export type PullRequest = {
  clientId: string;
  since: number;
};

export type PullResponse = {
  seq: number;
  lastMutationId: number;
  entries: LogEntry[];
  /** True when `since` is older than the retained log: client must re-bootstrap. */
  reset: boolean;
};

export type BootstrapResponse = {
  seq: number;
  lastMutationId: number;
  rows: Partial<Record<ModelName, Record<string, unknown>[]>>;
};

export type LoadRequest = {
  model: ModelName;
  parentId: string;
};

export type LoadResponse = {
  seq: number;
  rows: Record<string, unknown>[];
};

export type Poke = { type: "poke"; seq: number };

export type Transport = {
  bootstrap(clientId: string): Promise<BootstrapResponse>;
  push(req: PushRequest): Promise<PushResponse>;
  pull(req: PullRequest): Promise<PullResponse>;
  load(req: LoadRequest): Promise<LoadResponse>;
};
