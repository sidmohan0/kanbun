/**
 * The authoritative side of the sync engine. One instance per workspace,
 * living inside the workspace Durable Object. Everything is synchronous
 * except the commit listener, which the DO uses to poke WebSockets.
 */
import {
  modelNames,
  models,
  type ActorType,
  type ModelName,
  type BranchScope,
  type WorkspaceBranch,
} from "@kanbun/model";
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
import { DEFAULT_EVENT_PAGE_SIZE } from "../protocol";
import { tableMeta } from "../rows";
import { applyMigrations, type SqlDriver, type SqlValue } from "./driver";
import { SqliteStore, SYSTEM_TAG } from "./sqliteStore";
import { appendEvent, decodeEvent } from "./eventLog";
import { SqliteBranchStore } from "./branchStore";
import { WorkspaceBranches, type CreateBranchOptions } from "./branches";
import { BranchMerger, type BranchPreview, type BranchMergeResult, type MergeBranchOptions } from "./branchMerge";
import type { Store } from "../store";

export type CommitListener = (seq: number, branchId: string) => void;

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
  private listeners = new Set<{ notify: CommitListener; branchId: string }>();
  private readonly now: () => string;
  private readonly maxBatch: number;
  private readonly newTxnId: () => string;
  private readonly branches: WorkspaceBranches;
  private readonly branchMerger: BranchMerger;

  constructor(private readonly opts: ServerOptions) {
    this.store = new SqliteStore(opts.driver);
    this.now = opts.now ?? (() => new Date().toISOString());
    this.maxBatch = opts.maxBatch ?? 500;
    this.newTxnId = opts.newTxnId ?? randomId;
    if (opts.migrations) applyMigrations(opts.driver, opts.migrations);
    this.branches = new WorkspaceBranches(
      opts.driver,
      this.store,
      (actor) => this.branchPermissions(actor),
      this.now,
      this.newTxnId,
    );
    this.branchMerger = new BranchMerger({
      driver: opts.driver,
      store: this.store,
      mutators: opts.mutators,
      getBranch: (actor, branchId) => this.getBranch(actor, branchId),
      visibleTeamIds: (actor) => this.visibleTeamIds(actor),
      enforceScopes: (scope, txnId) => this.enforceScopes(scope, txnId, this.store, "branch", "main"),
      currentSeq: () => this.currentSeq(),
      now: this.now,
      newTxnId: this.newTxnId,
    });
  }

  /** Main is the default; branch subscribers also observe live-main commits. */
  onCommit(notify: CommitListener, branchId = "main"): () => void {
    const subscription = { notify, branchId: this.branchId(branchId) };
    this.listeners.add(subscription);
    return () => this.listeners.delete(subscription);
  }

  private emitCommit(seq: number, branchId: string): void {
    for (const subscription of this.listeners) {
      if (branchId === "main" || subscription.branchId === branchId) subscription.notify(seq, branchId);
    }
  }

  currentSeq(branchId = "main"): number {
    const r = this.opts.driver.all(`SELECT COALESCE(MAX(seq), 0) AS seq FROM sync_log WHERE branch_id IN ('main', ?)`, [
      branchId,
    ])[0];
    return Number(r?.["seq"] ?? 0);
  }

  createBranch(actor: Actor, input: CreateBranchOptions): WorkspaceBranch {
    return this.branches.create(actor, input);
  }

  getBranch(actor: Actor, branchId: string): WorkspaceBranch {
    return this.branches.get(actor, branchId);
  }

  previewBranch(actor: Actor, branchId: string): BranchPreview {
    return this.branchMerger.preview(actor, branchId);
  }

  mergeBranch(actor: Actor, input: MergeBranchOptions): BranchMergeResult {
    const before = this.currentSeq();
    const result = this.branchMerger.merge(actor, input);
    if (result.ok && result.mainSyncSeq > before) this.emitCommit(result.mainSyncSeq, "main");
    return result;
  }

  private branchId(value: string | undefined): string {
    if (value === undefined) return "main";
    if (typeof value !== "string" || !value.length) throw new MutationError("Invalid workspace branch id");
    return value;
  }

  private branchPermissions(actor: Actor) {
    if (actor.type !== "user" && actor.type !== "agent")
      throw new MutationError("Workspace branch access requires a user or agent", "forbidden");
    const userId = this.effectiveUserId(actor);
    const user = this.store.get("user", userId);
    if (!user || !user.active || user.archivedAt)
      throw new MutationError("Workspace member is not active", "forbidden");
    return {
      userId,
      teamIds: this.visibleTeamIds(actor),
      projectIds: actor.type === "agent" ? this.agentRow(actor.id).scopes.projectIds : [],
    };
  }

  private view(actor: Actor, branchId: string): SqliteStore | SqliteBranchStore {
    if (branchId === "main") return this.store;
    const branch = this.getBranch(actor, branchId);
    if (branch.status !== "open") throw new MutationError("Workspace branch is not open", "forbidden");
    return new SqliteBranchStore(this.opts.driver, branchId);
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
  private eventCause(actor: Actor, syncSeq: number | undefined, branchId = "main"): number | null {
    if (syncSeq === undefined) return null;
    const scope = this.scopeSql(this.visibleTeamIds(actor), this.effectiveUserId(actor), "team_id", "scope_user_id");
    const row = this.opts.driver.all(
      `SELECT event_seq FROM sync_log WHERE seq = ? AND branch_id IN ('main', ?) AND (${scope.sql})`,
      [syncSeq, branchId, ...scope.params],
    )[0];
    return row?.["event_seq"] == null ? null : Number(row["event_seq"]);
  }

  // ---- client bookkeeping ---------------------------------------------------

  /**
   * `visibleTeams` is the team set the client last bootstrapped against. Only
   * bootstrap writes it: a pull that sees the set has changed answers
   * `reset` and leaves it alone, so the client keeps being told to reset
   * until it actually bootstraps again.
   */
  private clientRow(
    clientId: string,
    actor: Actor,
    branchId = "main",
  ): { lastMutationId: number; visibleTeams: string } {
    const r = this.opts.driver.all(
      `SELECT last_mutation_id, user_id, visible_teams, branch_id FROM sync_client WHERE client_id = ?`,
      [clientId],
    )[0];
    if (!r) {
      this.opts.driver.run(
        `INSERT INTO sync_client (client_id, user_id, last_mutation_id, last_seen_at, visible_teams, branch_id) VALUES (?, ?, 0, ?, '', ?)`,
        [clientId, actor.id, this.now(), branchId],
      );
      return { lastMutationId: 0, visibleTeams: "" };
    }
    if (r["user_id"] !== actor.id) throw new MutationError("client belongs to another actor", "forbidden");
    if (r["branch_id"] !== branchId) throw new MutationError("client belongs to another workspace branch", "forbidden");
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

  bootstrap(actor: Actor, clientId: string, selectedBranch = "main"): BootstrapResponse {
    return this.opts.driver.transaction(() => {
      const branchId = this.branchId(selectedBranch);
      const view = this.view(actor, branchId);
      const teams = this.visibleTeamIds(actor);
      const userId = this.effectiveUserId(actor);
      const client = this.clientRow(clientId, actor, branchId);
      const seq = this.currentSeq(branchId);
      const rows: BootstrapResponse["rows"] = {};
      for (const name of modelNames) {
        const def = models[name];
        if (def.policy.kind === "onDemand") continue;
        if (view instanceof SqliteBranchStore) {
          rows[name] = view.list(name).filter((row) => {
            const record = row as Record<string, unknown>;
            if (def.teamColumn && record[def.teamColumn] != null && !teams.includes(String(record[def.teamColumn])))
              return false;
            return def.policy.kind !== "perUser" || record[def.policy.userColumn] === userId;
          }) as Record<string, unknown>[];
          continue;
        }
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
      return { seq, lastMutationId: client.lastMutationId, rows, ...(branchId === "main" ? {} : { branchId }) };
    });
  }

  // ---- load (on-demand models) -----------------------------------------------

  load(actor: Actor, req: LoadRequest): LoadResponse {
    const branchId = this.branchId(req.branchId);
    const view = this.view(actor, branchId);
    const def = models[req.model];
    if (def.policy.kind !== "onDemand") throw new MutationError(`${req.model} is not on-demand`, "invalid");
    // Parent must be visible: on-demand models hang off issues, so check the issue's team.
    const parent = view.get("issue", req.parentId);
    if (parent && !this.visibleTeamIds(actor).includes(parent.teamId))
      throw new MutationError("not visible", "forbidden");
    if (view instanceof SqliteBranchStore) {
      const rows = parent
        ? view
            .list(req.model)
            .filter(
              (row) =>
                (row as Record<string, unknown>)[def.policy.kind === "onDemand" ? def.policy.parentColumn : ""] ===
                req.parentId,
            )
        : [];
      return { seq: this.currentSeq(branchId), rows: rows as Record<string, unknown>[], branchId };
    }
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
        const branchId = this.branchId(req.branchId);
        const view = this.view(actor, branchId);
        const branch = branchId === "main" ? null : this.getBranch(actor, branchId);
        const client = this.clientRow(req.clientId, actor, branchId);
        const sorted = [...req.mutations].sort((a, b) => a.id - b.id);
        // Retries of already-applied mutations are free; the budget counts new work only.
        const fresh = sorted.filter((m) => m.id > client.lastMutationId);
        const agent = actor.type === "agent" ? this.agentGate(actor.id, fresh.length, branchId) : null;
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
            store: view.withTag({
              actorId: actor.id,
              actorType: actor.type,
              clientId: req.clientId,
              mutationId: m.id,
              txnId,
              causationSeq: m.causationSeq ?? null,
              reason: m.reason ?? null,
              branchId,
            }),
            actor,
            actorId: actor.id,
            now: this.now(),
            server: true,
            branchId,
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
                  causationSeq: this.eventCause(actor, m.causationSeq, branchId),
                  reason: m.reason ?? null,
                  branchId,
                });
                apply(
                  {
                    ...ctx,
                    store: view.withTag({
                      actorId: actor.id,
                      actorType: actor.type,
                      clientId: req.clientId,
                      mutationId: m.id,
                      txnId,
                      eventSeq: event.seq,
                      ts: new Date(event.ts).toISOString(),
                      causationSeq: m.causationSeq ?? null,
                      reason: event.reason,
                      branchId,
                    }),
                  },
                  event,
                );
              });
              if (agent) this.enforceScopes(agent.scopes, txnId, view, "agent", branchId);
              if (branch) this.enforceScopes(branch.scope, txnId, view, "branch", branchId);
            });
          } catch (e) {
            rejected.push({ id: m.id, error: e instanceof Error ? e.message : String(e) });
          }
        }
        this.touchClient(req.clientId, last);
        if (actor.type === "agent" && branchId === "main")
          this.opts.driver.run(`UPDATE agent SET last_active_at = ? WHERE id = ?`, [this.now(), actor.id]);
        return {
          ok: true as const,
          lastMutationId: last,
          seq: this.currentSeq(branchId),
          rejected,
          ...(branchId === "main" ? {} : { branchId }),
        };
      });
    } catch (e) {
      if (e instanceof MutationError)
        return { ok: false, error: e.message, code: e.code === "forbidden" ? "unauthorized" : "gap" };
      return { ok: false, error: e instanceof Error ? e.message : String(e), code: "internal" };
    }
    if (result.ok && result.seq > 0) this.emitCommit(result.seq, req.branchId ?? "main");
    return result;
  }

  /** Checks the agent is active and within its hourly budget for `count` new mutations; returns its row. */
  private agentGate(agentId: string, count: number, branchId = "main"): ReturnType<SyncServer["agentRow"]> {
    const a = this.agentRow(agentId);
    if (a.mode === "propose" && branchId === "main") {
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
  private enforceScopes(scope: BranchScope, txnId: string, view: Store, label: string, branchId: string): void {
    const { teamIds, projectIds } = scope;
    if (teamIds.length) {
      const marks = teamIds.map(() => "?").join(", ");
      const outside = this.opts.driver.all(
        `SELECT model, row_id FROM sync_log WHERE txn_id = ? AND branch_id = ? AND ((team_id IS NOT NULL AND team_id NOT IN (${marks})) OR (prev_team_id IS NOT NULL AND prev_team_id NOT IN (${marks}))) LIMIT 1`,
        [txnId, branchId, ...teamIds, ...teamIds],
      )[0];
      if (outside)
        throw new MutationError(
          `${label} is not scoped to the team of ${outside["model"]} ${outside["row_id"]}`,
          "forbidden",
        );
    }
    if (projectIds.length) {
      const marks = projectIds.map(() => "?").join(", ");
      const issues = this.opts.driver.all(
        "SELECT DISTINCT row_id FROM sync_log WHERE txn_id = ? AND branch_id = ? AND model = 'issue'",
        [txnId, branchId],
      );
      for (const row of issues) {
        const issue = view.get("issue", String(row["row_id"]));
        if (issue && (issue.projectId === null || !projectIds.includes(issue.projectId)))
          throw new MutationError(`${label} is scoped to projects; issue ${issue.id} is outside them`, "forbidden");
      }
      const project = this.opts.driver.all(
        `SELECT row_id FROM sync_log WHERE txn_id = ? AND branch_id = ? AND model IN ('project', 'projectMilestone', 'projectTeam') AND row_id NOT IN (${marks}) LIMIT 1`,
        [txnId, branchId, ...projectIds],
      )[0];
      if (project) throw new MutationError(`${label} is scoped to projects; cannot change other projects`, "forbidden");
    }
  }

  /** Private adapter entry point: only a DocumentDO result can publish a text mirror.
   * The current reader is authorized by decide; the durable document retains its original editor
   * so recovery of a committed body does not attribute that edit to the reader who repaired it.
   */
  commitDocument(actor: Actor, args: unknown, editor: Actor = actor): void {
    if (actor.type !== "user" || editor.type !== "user")
      throw new MutationError("Only people may edit collaborative descriptions", "forbidden");
    const def = this.opts.mutators["issueDescribe"];
    if (!def) throw new MutationError("Document publication is unavailable");
    const seq = this.opts.driver.transaction(() => {
      const txnId = this.newTxnId();
      const tag = {
        actorId: editor.id,
        actorType: editor.type,
        txnId,
        clientId: null,
        mutationId: null,
        causationSeq: null,
        reason: null,
      };
      const ctx: MutatorContext = {
        store: this.store.withTag(tag),
        actor,
        actorId: actor.id,
        now: this.now(),
        server: true,
        documentAuthority: true,
      };
      executeMutator(def, ctx, parseArgs("issueDescribe", def, args), (pending, eventIndex, apply) => {
        const event = appendEvent(this.opts.driver, pending, {
          actor: editor,
          txnId,
          eventIndex,
          clientId: null,
          mutationId: null,
          ts: Date.parse(ctx.now),
          causationSeq: null,
          reason: null,
        });
        apply(
          { ...ctx, store: this.store.withTag({ ...tag, eventSeq: event.seq, ts: new Date(event.ts).toISOString() }) },
          event,
        );
      });
      return this.currentSeq();
    });
    this.emitCommit(seq, "main");
  }

  /** Run a mutation as the system actor (member sync, scheduled jobs). */
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
    this.emitCommit(seq, "main");
  }

  // ---- pull -------------------------------------------------------------------

  pull(actor: Actor, req: PullRequest): PullResponse {
    return this.opts.driver.transaction(() => {
      const branchId = this.branchId(req.branchId);
      const view = this.view(actor, branchId);
      const teams = this.visibleTeamIds(actor);
      const userId = this.effectiveUserId(actor);
      const client = this.clientRow(req.clientId, actor, branchId);
      const seq = this.currentSeq(branchId);
      const teamsKey = teams.join(",");
      this.touchClient(req.clientId, client.lastMutationId);
      // A client that never bootstrapped, or whose team set changed since it did, must bootstrap (again).
      if (client.visibleTeams !== teamsKey)
        return {
          seq,
          lastMutationId: client.lastMutationId,
          entries: [],
          reset: true,
          ...(branchId === "main" ? {} : { branchId }),
        };
      const scope = this.scopeSql(teams, userId, "team_id", "scope_user_id");
      // Rows that left the viewer's scope (prev_team_id visible, team_id not) come through as deletes.
      const marks = teams.map(() => "?").join(", ");
      const leftScope = teams.length ? `prev_team_id IN (${marks})` : "0";
      const rows = this.opts.driver.all(
        `SELECT seq, branch_id, model, row_id, op, patch, (${scope.sql}) AS visible FROM sync_log
         WHERE seq > ? AND branch_id IN ('main', ?) AND ((${scope.sql}) OR ${leftScope}) ORDER BY seq ASC`,
        [...scope.params, req.since, branchId, ...scope.params, ...teams],
      );
      const entries: LogEntry[] = rows
        .filter(
          (r) =>
            !(
              view instanceof SqliteBranchStore &&
              r["branch_id"] === "main" &&
              view.hasOverlay(r["model"] as ModelName, String(r["row_id"]))
            ),
        )
        .map((r) => ({
          seq: Number(r["seq"]),
          model: r["model"] as ModelName,
          id: r["row_id"] as string,
          op: r["visible"] ? (r["op"] as "upsert" | "delete") : "delete",
          patch: r["visible"] && r["patch"] ? (JSON.parse(r["patch"] as string) as Record<string, unknown>) : null,
        }));
      return {
        seq,
        lastMutationId: client.lastMutationId,
        entries: compact(entries),
        reset: false,
        ...(branchId === "main" ? {} : { branchId }),
      };
    });
  }

  // ---- activity ------------------------------------------------------------------

  /** Committed semantic events visible to this actor, ordered for deterministic replay. */
  events(
    actor: Actor,
    filter: {
      since?: number;
      entityId?: string;
      issueId?: string;
      before?: number;
      order?: "asc" | "desc";
      limit?: number;
      branchId?: string;
    } = {},
  ): DomainEvent[] {
    const branchId = this.branchId(filter.branchId);
    const view = this.view(actor, branchId);
    const since = filter.since ?? 0;
    const limit = filter.limit ?? DEFAULT_EVENT_PAGE_SIZE;
    if (!Number.isSafeInteger(since) || since < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 5000)
      throw new MutationError("Invalid event cursor or limit");
    const teams = this.visibleTeamIds(actor);
    let issueStart: { column: "seq" | "ts"; value: number } | null = null;
    if (filter.issueId !== undefined) {
      const issue = view.get("issue", filter.issueId);
      if (!issue) throw new MutationError("issue not found", "not_found");
      if (!teams.includes(issue.teamId)) throw new MutationError("not visible", "forbidden");
      issueStart =
        issue.createdSeq > 0
          ? { column: "seq", value: issue.createdSeq }
          : { column: "ts", value: Date.parse(issue.createdAt) };
      if (!Number.isSafeInteger(issueStart.value)) throw new MutationError("Invalid issue creation boundary");
    }
    if (
      (filter.before !== undefined && (!Number.isSafeInteger(filter.before) || filter.before <= 0)) ||
      (filter.order !== undefined && filter.order !== "asc" && filter.order !== "desc")
    )
      throw new MutationError("Invalid event pagination");
    const scope = this.scopeSql(teams, this.effectiveUserId(actor), "team_id", "scope_user_id");
    const clauses = ["branch_id = ?", "seq > ?", scope.sql];
    const params: SqlValue[] = [branchId, since, ...scope.params];
    if (issueStart) {
      clauses.push(`${issueStart.column} >= ?`);
      params.push(issueStart.value);
    }
    if (filter.entityId !== undefined) {
      clauses.push("entity_id = ?");
      params.push(filter.entityId);
    }
    if (filter.issueId !== undefined) {
      clauses.push(
        "((entity_type = 'issue' AND entity_id = ?) OR (entity_type = 'comment' AND json_extract(payload, '$.issueId') = ?))",
      );
      params.push(filter.issueId, filter.issueId);
    }
    if (filter.before !== undefined) {
      clauses.push("seq < ?");
      params.push(filter.before);
    }
    return this.opts.driver
      .all(
        `SELECT * FROM event_log WHERE ${clauses.join(" AND ")} ORDER BY seq ${filter.order === "desc" ? "DESC" : "ASC"} LIMIT ?`,
        [...params, limit],
      )
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
      branchId?: string;
    } = {},
  ): ActivityEntry[] {
    const branchId = this.branchId(filter.branchId);
    this.view(actor, branchId);
    const teams = this.visibleTeamIds(actor);
    const userId = this.effectiveUserId(actor);
    const scope = this.scopeSql(teams, userId, "team_id", "scope_user_id");
    const clauses = ["branch_id = ?", scope.sql];
    const params: SqlValue[] = [branchId, ...scope.params];
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
