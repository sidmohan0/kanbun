/**
 * The authoritative side of the sync engine. One instance per workspace,
 * living inside the workspace Durable Object. Everything is synchronous
 * except the commit listener, which the DO uses to poke WebSockets.
 */
import { modelNames, models, type ActorType, type ModelName } from "@kanbun/model";
import type { DomainEvent } from "@kanbun/events";
import {
  executeMutator,
  MutationError,
  parseArgs,
  type Actor,
  type MutatorContext,
  type MutatorMap,
} from "../mutators";
import type {
  ActivityEntry,
  BootstrapResponse,
  LoadRequest,
  LoadResponse,
  LogEntry,
  PullRequest,
  PullResponse,
  PushRequest,
  PushResponse,
} from "../protocol";
import { tableMeta } from "../rows";
import { applyMigrations, type SqlDriver, type SqlValue } from "./driver";
import { SqliteStore, SYSTEM_TAG } from "./sqliteStore";
import { appendEvent, decodeEvent } from "./eventLog";

export type CommitListener = (seq: number) => void;

export type ServerOptions = {
  driver: SqlDriver;
  mutators: MutatorMap;
  migrations?: { journal: { entries: { idx: number; tag: string }[] }; migrations: Record<string, string> };
  now?: () => string;
  /** Maximum mutations accepted in one push. */
  maxBatch?: number;
  newTxnId?: () => string;
};

export const SYSTEM_ACTOR: Actor = { id: "system", type: "system" };

export class SyncServer {
  readonly store: SqliteStore;
  private listeners = new Set<CommitListener>();
  private readonly now: () => string;
  private readonly maxBatch: number;
  private readonly newTxnId: () => string;

  constructor(private readonly opts: ServerOptions) {
    this.store = new SqliteStore(opts.driver);
    this.now = opts.now ?? (() => new Date().toISOString());
    this.maxBatch = opts.maxBatch ?? 500;
    this.newTxnId = opts.newTxnId ?? randomId;
    if (opts.migrations) applyMigrations(opts.driver, opts.migrations);
  }

  onCommit(l: CommitListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  currentSeq(): number {
    const r = this.opts.driver.all(`SELECT COALESCE(MAX(seq), 0) AS seq FROM sync_log`)[0];
    return Number(r?.["seq"] ?? 0);
  }

  // ---- permissions ---------------------------------------------------------

  /** Teams whose rows this actor may see: public teams plus private teams the user belongs to. Agents inherit their owner. */
  visibleTeamIds(actor: Actor): string[] {
    const userId = this.effectiveUserId(actor);
    if (actor.type === "system") {
      return this.opts.driver
        .all(`SELECT id FROM team`)
        .map((r) => r["id"] as string)
        .sort();
    }
    const rows = this.opts.driver.all(
      `SELECT t.id AS id FROM team t
       WHERE t.visibility = 'public'
          OR EXISTS (SELECT 1 FROM team_membership m WHERE m.team_id = t.id AND m.user_id = ? AND m.archived_at IS NULL)`,
      [userId],
    );
    let ids = rows.map((r) => r["id"] as string);
    if (actor.type === "agent") {
      const scoped = this.agentRow(actor.id).scopes.teamIds;
      if (scoped.length) ids = ids.filter((id) => scoped.includes(id));
    }
    return ids.sort();
  }

  /** The user whose permissions apply: the user, or an agent's owner. */
  private effectiveUserId(actor: Actor): string {
    if (actor.type === "agent") return this.agentRow(actor.id).ownerId;
    return actor.id;
  }

  private agentRow(agentId: string): {
    ownerId: string;
    scopes: { teamIds: string[]; projectIds: string[]; mutators: string[] };
    mode: string;
    rateBudget: number;
    active: boolean;
  } {
    const a = this.store.get("agent", agentId);
    if (!a || !a.active || a.archivedAt) throw new MutationError("agent not found or inactive", "forbidden");
    return a;
  }

  private scopeSql(
    teamIds: string[],
    userId: string,
    teamCol: string,
    userCol: string,
  ): { sql: string; params: SqlValue[] } {
    const marks = teamIds.map(() => "?").join(", ");
    const teamClause = teamIds.length ? `(${teamCol} IS NULL OR ${teamCol} IN (${marks}))` : `${teamCol} IS NULL`;
    return { sql: `${teamClause} AND (${userCol} IS NULL OR ${userCol} = ?)`, params: [...teamIds, userId] };
  }

  /** The wire API uses patch cursors; semantic history references the producing event. */
  private eventCause(actor: Actor, syncSeq: number | undefined): number | null {
    if (syncSeq === undefined) return null;
    const scope = this.scopeSql(this.visibleTeamIds(actor), this.effectiveUserId(actor), "team_id", "scope_user_id");
    const row = this.opts.driver.all(`SELECT event_seq FROM sync_log WHERE seq = ? AND (${scope.sql})`, [
      syncSeq,
      ...scope.params,
    ])[0];
    return row?.["event_seq"] == null ? null : Number(row["event_seq"]);
  }

  // ---- client bookkeeping ---------------------------------------------------

  /**
   * `visibleTeams` is the team set the client last bootstrapped against. Only
   * bootstrap writes it: a pull that sees the set has changed answers
   * `reset` and leaves it alone, so the client keeps being told to reset
   * until it actually bootstraps again.
   */
  private clientRow(clientId: string, actor: Actor): { lastMutationId: number; visibleTeams: string } {
    const r = this.opts.driver.all(
      `SELECT last_mutation_id, user_id, visible_teams FROM sync_client WHERE client_id = ?`,
      [clientId],
    )[0];
    if (!r) {
      this.opts.driver.run(
        `INSERT INTO sync_client (client_id, user_id, last_mutation_id, last_seen_at, visible_teams) VALUES (?, ?, 0, ?, '')`,
        [clientId, actor.id, this.now()],
      );
      return { lastMutationId: 0, visibleTeams: "" };
    }
    if (r["user_id"] !== actor.id) throw new MutationError("client belongs to another actor", "forbidden");
    return { lastMutationId: Number(r["last_mutation_id"]), visibleTeams: String(r["visible_teams"] ?? "") };
  }

  private touchClient(clientId: string, lastMutationId: number, visibleTeams?: string): void {
    if (visibleTeams === undefined) {
      this.opts.driver.run(`UPDATE sync_client SET last_mutation_id = ?, last_seen_at = ? WHERE client_id = ?`, [
        lastMutationId,
        this.now(),
        clientId,
      ]);
      return;
    }
    this.opts.driver.run(
      `UPDATE sync_client SET last_mutation_id = ?, last_seen_at = ?, visible_teams = ? WHERE client_id = ?`,
      [lastMutationId, this.now(), visibleTeams, clientId],
    );
  }

  private colName(model: ModelName, key: string): string {
    const c = tableMeta(model).byKey.get(key);
    if (!c) throw new Error(`registry: ${model}.${key} is not a column`);
    return `"${c.name}"`;
  }

  // ---- bootstrap --------------------------------------------------------------

  bootstrap(actor: Actor, clientId: string): BootstrapResponse {
    return this.opts.driver.transaction(() => {
      const teams = this.visibleTeamIds(actor);
      const userId = this.effectiveUserId(actor);
      const client = this.clientRow(clientId, actor);
      const seq = this.currentSeq();
      const rows: BootstrapResponse["rows"] = {};
      for (const name of modelNames) {
        const def = models[name];
        if (def.policy.kind === "onDemand") continue;
        const clauses: string[] = [];
        const params: SqlValue[] = [];
        if (def.teamColumn) {
          const col = this.colName(name, def.teamColumn);
          if (teams.length) {
            clauses.push(`(${col} IS NULL OR ${col} IN (${teams.map(() => "?").join(", ")}))`);
            params.push(...teams);
          } else clauses.push(`${col} IS NULL`);
        }
        if (def.policy.kind === "perUser") {
          clauses.push(`${this.colName(name, def.policy.userColumn)} = ?`);
          params.push(userId);
        }
        rows[name] = this.store.rawList(name, clauses.join(" AND "), params) as Record<string, unknown>[];
      }
      this.touchClient(clientId, client.lastMutationId, teams.join(","));
      return { seq, lastMutationId: client.lastMutationId, rows };
    });
  }

  // ---- load (on-demand models) -----------------------------------------------

  load(actor: Actor, req: LoadRequest): LoadResponse {
    const def = models[req.model];
    if (def.policy.kind !== "onDemand") throw new MutationError(`${req.model} is not on-demand`, "invalid");
    // Parent must be visible: on-demand models hang off issues, so check the issue's team.
    const parent = this.store.get("issue", req.parentId);
    if (parent && !this.visibleTeamIds(actor).includes(parent.teamId))
      throw new MutationError("not visible", "forbidden");
    const rows = this.store.rawList(req.model, `${this.colName(req.model, def.policy.parentColumn)} = ?`, [
      req.parentId,
    ]);
    return { seq: this.currentSeq(), rows: rows as Record<string, unknown>[] };
  }

  // ---- push -------------------------------------------------------------------

  push(actor: Actor, req: PushRequest): PushResponse {
    if (req.mutations.length > this.maxBatch) return { ok: false, error: "batch too large", code: "internal" };
    let result: PushResponse;
    try {
      result = this.opts.driver.transaction(() => {
        const client = this.clientRow(req.clientId, actor);
        const sorted = [...req.mutations].sort((a, b) => a.id - b.id);
        // Retries of already-applied mutations are free; the budget counts new work only.
        const fresh = sorted.filter((m) => m.id > client.lastMutationId);
        const agent = actor.type === "agent" ? this.agentGate(actor.id, fresh.length) : null;
        let last = client.lastMutationId;
        const rejected: { id: number; error: string }[] = [];
        for (const m of fresh) {
          if (m.id !== last + 1) throw new MutationError(`mutation gap: expected ${last + 1}, got ${m.id}`, "conflict");
          last = m.id;
          const def = this.opts.mutators[m.name];
          if (!def) {
            rejected.push({ id: m.id, error: `unknown mutator ${m.name}` });
            continue;
          }
          if (agent && agent.scopes.mutators.length && !agent.scopes.mutators.includes(m.name)) {
            rejected.push({ id: m.id, error: `agent is not allowed to call ${m.name}` });
            continue;
          }
          const txnId = this.newTxnId();
          const ctx: MutatorContext = {
            store: this.store.withTag({
              actorId: actor.id,
              actorType: actor.type,
              clientId: req.clientId,
              mutationId: m.id,
              txnId,
              causationSeq: m.causationSeq ?? null,
              reason: m.reason ?? null,
            }),
            actor,
            actorId: actor.id,
            now: this.now(),
            server: true,
            ...(m.reason !== undefined ? { reason: m.reason } : {}),
            ...(m.causationSeq !== undefined ? { causationSeq: m.causationSeq } : {}),
          };
          // Each mutation runs in its own savepoint so a rejected one leaves no partial writes.
          try {
            this.opts.driver.savepoint(() => {
              executeMutator(def, ctx, parseArgs(m.name, def, m.args), (pending, eventIndex, apply) => {
                const event = appendEvent(this.opts.driver, pending, {
                  actor,
                  txnId,
                  eventIndex,
                  clientId: req.clientId,
                  mutationId: m.id,
                  ts: Date.parse(ctx.now),
                  causationSeq: this.eventCause(actor, m.causationSeq),
                  reason: m.reason ?? null,
                });
                apply(
                  {
                    ...ctx,
                    store: this.store.withTag({
                      actorId: actor.id,
                      actorType: actor.type,
                      clientId: req.clientId,
                      mutationId: m.id,
                      txnId,
                      eventSeq: event.seq,
                      ts: new Date(event.ts).toISOString(),
                      causationSeq: m.causationSeq ?? null,
                      reason: event.reason,
                    }),
                  },
                  event,
                );
              });
              if (agent) this.enforceAgentScopes(agent, txnId);
            });
          } catch (e) {
            rejected.push({ id: m.id, error: e instanceof Error ? e.message : String(e) });
          }
        }
        this.touchClient(req.clientId, last);
        if (actor.type === "agent")
          this.opts.driver.run(`UPDATE agent SET last_active_at = ? WHERE id = ?`, [this.now(), actor.id]);
        return { ok: true as const, lastMutationId: last, seq: this.currentSeq(), rejected };
      });
    } catch (e) {
      if (e instanceof MutationError)
        return { ok: false, error: e.message, code: e.code === "forbidden" ? "unauthorized" : "gap" };
      return { ok: false, error: e instanceof Error ? e.message : String(e), code: "internal" };
    }
    if (result.ok && result.seq > 0) for (const l of this.listeners) l(result.seq);
    return result;
  }

  /** Checks the agent is active and within its hourly budget for `count` new mutations; returns its row. */
  private agentGate(agentId: string, count: number): ReturnType<SyncServer["agentRow"]> {
    const a = this.agentRow(agentId);
    if (a.mode === "propose") {
      // Proposals (phase 2) will route these writes into a named overlay for human review.
      throw new MutationError("agent is in propose mode; direct commits are not allowed", "forbidden");
    }
    if (count === 0) return a;
    const since = new Date(Date.parse(this.now()) - 3600_000).toISOString();
    const used = this.opts.driver.all(
      `SELECT COUNT(DISTINCT txn_id) AS n FROM sync_log WHERE actor_type = 'agent' AND actor_id = ? AND ts > ?`,
      [agentId, since],
    )[0];
    if (Number(used?.["n"] ?? 0) + count > a.rateBudget)
      throw new MutationError("agent rate budget exceeded", "forbidden");
    return a;
  }

  /**
   * After an agent's mutation ran, check every row it wrote against its team
   * and project scopes. Done on the log rather than per mutator so no mutator
   * can forget it; a violation throws, which rolls the mutation back.
   */
  private enforceAgentScopes(agent: ReturnType<SyncServer["agentRow"]>, txnId: string): void {
    const { teamIds, projectIds } = agent.scopes;
    if (teamIds.length) {
      const marks = teamIds.map(() => "?").join(", ");
      const outside = this.opts.driver.all(
        `SELECT model, row_id FROM sync_log WHERE txn_id = ? AND ((team_id IS NOT NULL AND team_id NOT IN (${marks})) OR (prev_team_id IS NOT NULL AND prev_team_id NOT IN (${marks}))) LIMIT 1`,
        [txnId, ...teamIds, ...teamIds],
      )[0];
      if (outside)
        throw new MutationError(
          `agent is not scoped to the team of ${outside["model"]} ${outside["row_id"]}`,
          "forbidden",
        );
    }
    if (projectIds.length) {
      const marks = projectIds.map(() => "?").join(", ");
      const outside = this.opts.driver.all(
        `SELECT i.id FROM issue i WHERE i.id IN (SELECT row_id FROM sync_log WHERE txn_id = ? AND model = 'issue')
           AND (i.project_id IS NULL OR i.project_id NOT IN (${marks})) LIMIT 1`,
        [txnId, ...projectIds],
      )[0];
      if (outside)
        throw new MutationError(`agent is scoped to projects; issue ${outside["id"]} is outside them`, "forbidden");
      const project = this.opts.driver.all(
        `SELECT row_id FROM sync_log WHERE txn_id = ? AND model IN ('project', 'projectMilestone', 'projectTeam') AND row_id NOT IN (${marks}) LIMIT 1`,
        [txnId, ...projectIds],
      )[0];
      if (project) throw new MutationError("agent is scoped to projects; cannot change other projects", "forbidden");
    }
  }

  /** Run a mutation as the system actor (member sync, text mirrors, scheduled jobs). */
  system(name: string, args: unknown, extra: { reason?: string; causationSeq?: number } = {}): void {
    const def = this.opts.mutators[name];
    if (!def) throw new MutationError(`unknown mutator ${name}`);
    const seq = this.opts.driver.transaction(() => {
      const txnId = this.newTxnId();
      const ctx: MutatorContext = {
        store: this.store.withTag({
          ...SYSTEM_TAG(txnId),
          causationSeq: extra.causationSeq ?? null,
          reason: extra.reason ?? null,
        }),
        actor: SYSTEM_ACTOR,
        actorId: SYSTEM_ACTOR.id,
        now: this.now(),
        server: true,
        ...extra,
      };
      executeMutator(def, ctx, parseArgs(name, def, args), (pending, eventIndex, apply) => {
        const event = appendEvent(this.opts.driver, pending, {
          actor: SYSTEM_ACTOR,
          txnId,
          eventIndex,
          clientId: null,
          mutationId: null,
          ts: Date.parse(ctx.now),
          causationSeq: this.eventCause(SYSTEM_ACTOR, extra.causationSeq),
          reason: extra.reason ?? null,
        });
        apply(
          {
            ...ctx,
            store: this.store.withTag({
              ...SYSTEM_TAG(txnId),
              eventSeq: event.seq,
              ts: new Date(event.ts).toISOString(),
              causationSeq: extra.causationSeq ?? null,
              reason: event.reason,
            }),
          },
          event,
        );
      });
      return this.currentSeq();
    });
    for (const l of this.listeners) l(seq);
  }

  // ---- pull -------------------------------------------------------------------

  pull(actor: Actor, req: PullRequest): PullResponse {
    return this.opts.driver.transaction(() => {
      const teams = this.visibleTeamIds(actor);
      const userId = this.effectiveUserId(actor);
      const client = this.clientRow(req.clientId, actor);
      const seq = this.currentSeq();
      const teamsKey = teams.join(",");
      this.touchClient(req.clientId, client.lastMutationId);
      // A client that never bootstrapped, or whose team set changed since it did, must bootstrap (again).
      if (client.visibleTeams !== teamsKey)
        return { seq, lastMutationId: client.lastMutationId, entries: [], reset: true };
      const scope = this.scopeSql(teams, userId, "team_id", "scope_user_id");
      // Rows that left the viewer's scope (prev_team_id visible, team_id not) come through as deletes.
      const marks = teams.map(() => "?").join(", ");
      const leftScope = teams.length ? `prev_team_id IN (${marks})` : "0";
      const rows = this.opts.driver.all(
        `SELECT seq, model, row_id, op, patch, (${scope.sql}) AS visible FROM sync_log
         WHERE seq > ? AND ((${scope.sql}) OR ${leftScope}) ORDER BY seq ASC`,
        [...scope.params, req.since, ...scope.params, ...teams],
      );
      const entries: LogEntry[] = rows.map((r) => ({
        seq: Number(r["seq"]),
        model: r["model"] as ModelName,
        id: r["row_id"] as string,
        op: r["visible"] ? (r["op"] as "upsert" | "delete") : "delete",
        patch: r["visible"] && r["patch"] ? (JSON.parse(r["patch"] as string) as Record<string, unknown>) : null,
      }));
      return { seq, lastMutationId: client.lastMutationId, entries: compact(entries), reset: false };
    });
  }

  // ---- activity ------------------------------------------------------------------

  /** Committed semantic events visible to this actor, ordered for deterministic replay. */
  events(actor: Actor, filter: { since?: number; entityId?: string; limit?: number } = {}): DomainEvent[] {
    const since = filter.since ?? 0;
    const limit = filter.limit ?? 500;
    if (!Number.isSafeInteger(since) || since < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 5000)
      throw new MutationError("Invalid event cursor or limit");
    const teams = this.visibleTeamIds(actor);
    const scope = this.scopeSql(teams, this.effectiveUserId(actor), "team_id", "scope_user_id");
    const clauses = ["branch_id = 'main'", "seq > ?", scope.sql];
    const params: SqlValue[] = [since, ...scope.params];
    if (filter.entityId !== undefined) {
      clauses.push("entity_id = ?");
      params.push(filter.entityId);
    }
    return this.opts.driver
      .all(`SELECT * FROM event_log WHERE ${clauses.join(" AND ")} ORDER BY seq ASC LIMIT ?`, [...params, limit])
      .map(decodeEvent);
  }

  /** The activity feed: log entries with provenance, newest first, optionally for one row or one actor type. */
  activity(
    actor: Actor,
    filter: {
      model?: ModelName;
      rowId?: string;
      actorType?: ActorType;
      txnId?: string;
      before?: number;
      limit?: number;
    } = {},
  ): ActivityEntry[] {
    const teams = this.visibleTeamIds(actor);
    const userId = this.effectiveUserId(actor);
    const scope = this.scopeSql(teams, userId, "team_id", "scope_user_id");
    const clauses = [scope.sql];
    const params: SqlValue[] = [...scope.params];
    if (filter.model) {
      clauses.push("model = ?");
      params.push(filter.model);
    }
    if (filter.rowId) {
      clauses.push("row_id = ?");
      params.push(filter.rowId);
    }
    if (filter.actorType) {
      clauses.push("actor_type = ?");
      params.push(filter.actorType);
    }
    if (filter.txnId) {
      clauses.push("txn_id = ?");
      params.push(filter.txnId);
    }
    if (filter.before) {
      clauses.push("seq < ?");
      params.push(filter.before);
    }
    const rows = this.opts.driver.all(
      `SELECT * FROM sync_log WHERE ${clauses.join(" AND ")} ORDER BY seq DESC LIMIT ${Math.min(filter.limit ?? 100, 500)}`,
      params,
    );
    return rows.map((r) => ({
      seq: Number(r["seq"]),
      model: r["model"] as ModelName,
      id: r["row_id"] as string,
      op: r["op"] as "upsert" | "delete",
      patch: r["patch"] ? (JSON.parse(r["patch"] as string) as Record<string, unknown>) : null,
      prev: r["prev"] ? (JSON.parse(r["prev"] as string) as Record<string, unknown>) : null,
      actorId: (r["actor_id"] as string | null) ?? null,
      actorType: r["actor_type"] as ActorType,
      txnId: r["txn_id"] as string,
      causationSeq: r["causation_seq"] === null ? null : Number(r["causation_seq"]),
      reason: (r["reason"] as string | null) ?? null,
      ts: r["ts"] as string,
    }));
  }
}

/** Merge consecutive upserts to the same row so a pull carries one entry per row. */
export function compact(entries: LogEntry[]): LogEntry[] {
  const out: LogEntry[] = [];
  const index = new Map<string, number>();
  for (const e of entries) {
    const key = `${e.model}/${e.id}`;
    const i = index.get(key);
    if (i !== undefined) {
      const prev = out[i]!;
      if (e.op === "delete" || prev.op === "delete") out[i] = { ...e };
      else out[i] = { ...e, patch: { ...(prev.patch ?? {}), ...(e.patch ?? {}) } };
      continue;
    }
    index.set(key, out.length);
    out.push({ ...e });
  }
  return out;
}

function randomId(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
