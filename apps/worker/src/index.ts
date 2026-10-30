import { DurableObject } from "cloudflare:workers";
import migrations from "@kanbun/model/migrations/workspace/migrations.js";
import { uuidv7 } from "@kanbun/model";
import { mutators, requireIssue } from "@kanbun/mutators";
import { issueIncarnation, MutationError, type Actor, type Poke, type WorkspaceContext } from "@kanbun/sync";
import { durableObjectDriver, SyncServer, type SqlDriver } from "@kanbun/sync/server";
import { z } from "zod";
import {
  configuration,
  forwardedRequest,
  hostedPrincipalSchema,
  mode,
  readPrincipal,
  requireHostedOrigin,
  verifyAccess,
  type AuthEnvironment,
  type HostedPrincipal,
} from "./auth";
import {
  activeMember,
  admitMember,
  acceptInvitation,
  inspectInvitation,
  listMembership,
  createInvitation,
  revokeInvitation,
  removeMembership,
  type DirectoryEnvironment,
} from "./directory";
import { localActors, seedWorkspace } from "./local";
import { preparePreview, projectMembershipRemoval } from "./preview";
import { DocumentDO, documentName } from "./document";
import {
  applyRestore,
  BACKUP_EVENT_INTERVAL,
  BACKUP_INTERVAL,
  BACKUP_JOB,
  createBackup,
  prepareRestore,
} from "./backups";
export { DocumentDO } from "./document";
import { internalFailure } from "./reporting";
import {
  activityQuery,
  body,
  bootstrapQuery,
  branchQuery,
  connectQuery,
  createBody,
  eventsQuery,
  loadQuery,
  mergeBody,
  pullQuery,
  pushBody,
  query,
  RequestError,
  seedBody,
} from "./requests";

export { localActors } from "./local";

export interface Env extends AuthEnvironment, DirectoryEnvironment {
  WORKSPACES: DurableObjectNamespace<WorkspaceDO>;
  DOCUMENTS: DurableObjectNamespace<DocumentDO>;
  ASSETS?: Fetcher;
  BACKUPS?: R2Bucket;
  BACKUP_RESTORE_ISOLATED?: string;
  BACKUP_RESTORE_SOURCE_COMMIT?: string;
  CF_VERSION_METADATA?: { id: string; tag: string; timestamp: string };
}

const routes = new Map<string, string>(
  Object.entries({
    "/api/context": "GET",
    "/api/members": "GET",
    "/api/invitations": "POST",
    "/api/invitations/revoke": "POST",
    "/api/members/remove": "POST",
    "/__local/seed": "POST",
    "/sync/bootstrap": "GET",
    "/sync/connect": "GET",
    "/sync/pull": "GET",
    "/sync/load": "GET",
    "/sync/push": "POST",
    "/sync/branch/create": "POST",
    "/sync/branch/get": "GET",
    "/sync/branch/preview": "GET",
    "/sync/branch/merge": "POST",
    "/sync/events": "GET",
    "/sync/activity": "GET",
    "/sync/document": "GET, POST",
  }),
);

const localPrincipalSchema = z.strictObject({
  mode: z.literal("local"),
  workspaceId: z.literal("local"),
  actor: z.strictObject({ id: z.enum([localActors.alice.id, localActors.bob.id]), type: z.literal("user") }),
});
const socketIdentity = z.discriminatedUnion("mode", [
  localPrincipalSchema.extend({ clientId: z.string().min(1), branchId: z.literal("main") }),
  hostedPrincipalSchema.extend({ clientId: z.string().min(1), branchId: z.literal("main") }),
]);
type Principal = z.infer<typeof localPrincipalSchema> | HostedPrincipal;
type SocketIdentity = z.infer<typeof socketIdentity>;

function json(value: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function disabled() {
  return json({ error: "Workspace routes are disabled; authentication is not configured" }, 503);
}

function syncRoute(path: string) {
  return path.startsWith("/sync/");
}

function localRoute(path: string) {
  return path.startsWith("/__local");
}

function selectedActor(request: Request): z.infer<typeof localPrincipalSchema>["actor"] {
  const name = request.headers.get("X-Kanbun-Local-Actor") ?? "alice";
  if (name !== "alice" && name !== "bob") throw new RequestError("Unknown local actor", 401);
  return localActors[name];
}

function localContext(actor: z.infer<typeof localPrincipalSchema>["actor"]): WorkspaceContext {
  const alice = actor.id === localActors.alice.id;
  return {
    mode: "local",
    role: alice ? "owner" : "member",
    admissionId: null,
    workspaceId: "local",
    workspaceName: "Local workspace",
    actor,
    name: alice ? "Alice" : "Bob",
    email: alice ? "alice@example.com" : "bob@example.com",
  };
}

function validateUpgrade(request: Request, env: Env) {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
    throw new RequestError("Expected a WebSocket upgrade", 426);
  if (mode(env) === "hosted") return requireHostedOrigin(request, env);
  const origin = request.headers.get("Origin");
  const expected = new URL(request.url);
  if (expected.protocol === "ws:") expected.protocol = "http:";
  if (expected.protocol === "wss:") expected.protocol = "https:";
  if (origin !== null && origin !== expected.origin) throw new RequestError("WebSocket origin is not allowed", 403);
}

function failure(error: unknown): Response {
  if (error instanceof RequestError) return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return json({ error: "Invalid request", issues: error.issues }, 400);
  if (error instanceof MutationError) {
    const status =
      error.code === "forbidden" ? 403 : error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 400;
    return json({ error: error.message, code: error.code }, status);
  }
  return internalFailure(error);
}

/** The authority is reached through the edge Worker's private binding, never a public DO URL. */
export class WorkspaceDO extends DurableObject<Env> {
  private readonly ready: Promise<void>;
  private readonly driver: SqlDriver;
  private server: SyncServer | undefined;
  private broadcastQueued = false;
  private lastBroadcastSeq = 0;
  private documentOperation: Promise<unknown> = Promise.resolve();
  private backupTask: Promise<{ key: string; manifestHash: string; mainSeq: number; eventSeq: number }> | null = null;
  private alarmRunning = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.driver = durableObjectDriver(ctx.storage);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      if (mode(env) === "disabled") {
        for (const socket of ctx.getWebSockets()) this.closeSocket(socket, 1008, "Workspace routes are disabled");
        return;
      }
      const server = new SyncServer({ driver: this.driver, mutators, migrations });
      this.server = server;
      this.lastBroadcastSeq = server.currentSeq();
      server.onCommit(() => {
        this.queueBroadcast();
        queueMicrotask(() =>
          this.ctx.waitUntil(this.scheduleBackup().catch(() => console.error("workspace_backup_schedule_failed"))),
        );
      });
      for (const socket of ctx.getWebSockets()) await this.authorizedSocket(socket, server);
      this.ctx.waitUntil(
        this.scheduleBackup()
          .then(async () => {
            if (this.automaticBackups()) await this.armNextJob(true);
          })
          .catch(() => console.error("workspace_backup_schedule_failed")),
      );
    });
  }

  private automaticBackups() {
    return (
      mode(this.env) === "hosted" &&
      this.env.BACKUPS &&
      this.env.ACCOUNTS &&
      this.env.BACKUP_RESTORE_ISOLATED !== "true"
    );
  }

  private backupJob() {
    return this.driver.all("SELECT * FROM scheduled_job WHERE dedup_key = ?", [BACKUP_JOB])[0];
  }

  private async armNextJob(skipActiveAttempt = false) {
    const row = this.driver.all("SELECT MIN(fire_at) AS fire_at FROM scheduled_job")[0];
    if (typeof row?.["fire_at"] !== "string") return;
    const fireAt = Date.parse(row["fire_at"]);
    if (!Number.isFinite(fireAt)) throw new Error("Scheduled job time is invalid");
    const current = await this.ctx.storage.getAlarm();
    if (skipActiveAttempt && (this.backupTask || this.alarmRunning)) return;
    if (current === null || fireAt < current) await this.ctx.storage.setAlarm(fireAt);
  }

  private async scheduleBackup() {
    if (
      !this.automaticBackups() ||
      !this.server?.store.list("organization").length ||
      this.backupTask ||
      this.alarmRunning
    )
      return;
    const job = this.backupJob();
    if (!job) {
      const now = new Date().toISOString();
      this.driver.run(
        "INSERT INTO scheduled_job (id, fire_at, kind, payload, dedup_key, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [uuidv7(), now, BACKUP_JOB, JSON.stringify({ lastEventSeq: 0 }), BACKUP_JOB, now],
      );
      await this.armNextJob(true);
      return;
    }
    const state = z.object({ lastEventSeq: z.number().int().nonnegative() }).parse(JSON.parse(String(job["payload"])));
    const seq = Number(
      this.driver.all("SELECT COALESCE(MAX(seq),0) AS seq FROM event_log WHERE branch_id = 'main'")[0]?.["seq"] ?? 0,
    );
    if (seq - state.lastEventSeq >= BACKUP_EVENT_INTERVAL && Date.parse(String(job["fire_at"])) > Date.now()) {
      this.driver.run("UPDATE scheduled_job SET fire_at = ? WHERE id = ?", [
        new Date().toISOString(),
        String(job["id"]),
      ]);
      await this.armNextJob(true);
      return;
    }
    // Recover a dropped or exhausted alarm on a later commit without competing with an active attempt.
    await this.armNextJob(true);
  }

  /** Private binding RPC; there is deliberately no HTTP backup or restore route. */
  async backup(workspaceId: string) {
    await this.ready;
    this.requireWorkspace(workspaceId);
    if (this.backupTask) return this.backupTask;
    const task = createBackup(this.driver, this.env, workspaceId).then(async (receipt) => {
      this.server!.recordSnapshot(workspaceId, {
        snapshotId: receipt.key,
        sourceSeq: receipt.eventSeq,
        contentHash: receipt.manifestHash,
      });
      const next = new Date(Date.now() + BACKUP_INTERVAL).toISOString();
      this.driver.run("UPDATE scheduled_job SET fire_at = ?, payload = ? WHERE dedup_key = ?", [
        next,
        JSON.stringify({ lastEventSeq: receipt.eventSeq, manifestKey: receipt.key }),
        BACKUP_JOB,
      ]);
      if (this.automaticBackups()) {
        await this.ctx.storage.setAlarm(Date.parse(next));
        await this.armNextJob();
      }
      return receipt;
    });
    this.backupTask = task;
    try {
      return await task;
    } finally {
      if (this.backupTask === task) this.backupTask = null;
    }
  }

  override async alarm() {
    await this.ready;
    if (!this.automaticBackups()) return;
    this.alarmRunning = true;
    try {
      const due = this.driver.all("SELECT * FROM scheduled_job WHERE fire_at <= ? ORDER BY fire_at", [
        new Date().toISOString(),
      ]);
      for (const job of due) {
        if (job["kind"] !== BACKUP_JOB) throw new Error("Unsupported scheduled job kind");
        try {
          await this.backup(configuration(this.env).workspaceId);
        } catch {
          console.error("workspace_backup_failed");
          throw new Error("Workspace backup failed");
        }
      }
      await this.armNextJob();
    } finally {
      this.alarmRunning = false;
    }
  }

  /** Private readiness check also prevents edge directory admission before restore completion. */
  async restoreComplete(workspaceId: string): Promise<boolean> {
    await this.ready;
    this.requireWorkspace(workspaceId);
    return (await this.ctx.storage.get("restore-progress")) === "complete";
  }

  /** Restores only a fresh, explicitly isolated namespace; normal JWT verification stays enabled. */
  async restoreBackup(workspaceId: string, key: string) {
    await this.ready;
    this.requireWorkspace(workspaceId);
    if (this.env.BACKUP_RESTORE_ISOLATED !== "true") throw new Error("Isolated restore is not enabled");
    if ((await this.ctx.storage.get("restore-progress")) !== undefined)
      throw new Error("Restore target has already been used");
    const bundle = await prepareRestore(this.driver, this.env, workspaceId, key);
    await this.ctx.storage.transaction(async (transaction) => {
      if ((await transaction.get("restore-progress")) !== undefined)
        throw new Error("Restore target has already been used");
      await transaction.put("restore-progress", "started");
    });
    await applyRestore(this.driver, this.env, workspaceId, bundle);
    await this.ctx.storage.put("restore-progress", "complete");
    this.lastBroadcastSeq = this.server?.currentSeq() ?? 0;
    return { key, mainSeq: bundle.manifest.mainSeq, eventSeq: bundle.manifest.eventSeq };
  }

  private requireActiveMember(server: SyncServer, actor: Actor) {
    const member = server.store.get("user", actor.id);
    if (!member?.active || member.archivedAt) throw new MutationError("Workspace member is not active", "forbidden");
  }

  private requireWorkspace(workspaceId: string) {
    const expected = mode(this.env) === "hosted" ? configuration(this.env).workspaceId : "local";
    if (workspaceId !== expected || this.ctx.id.toString() !== this.env.WORKSPACES.idFromName(workspaceId).toString())
      throw new RequestError("Workspace identity does not match its authority", 403);
  }

  private async authorizePrincipal(server: SyncServer, principal: Principal): Promise<WorkspaceContext> {
    this.requireWorkspace(principal.workspaceId);
    if (principal.mode !== mode(this.env)) throw new RequestError("Workspace identity is unavailable", 403);
    const context =
      principal.mode === "hosted" ? await activeMember(this.env, principal) : localContext(principal.actor);
    if (principal.mode === "hosted") preparePreview(server, this.driver, context, principal.admissionId);
    this.requireActiveMember(server, context.actor);
    return context;
  }

  private principal(request: Request): Principal {
    return mode(this.env) === "hosted"
      ? readPrincipal(request)
      : { mode: "local", workspaceId: "local", actor: selectedActor(request) };
  }

  private async requestContext(request: Request, server: SyncServer) {
    return this.authorizePrincipal(server, this.principal(request));
  }

  private async authorizeSocket(server: SyncServer, identity: SocketIdentity): Promise<number> {
    await this.authorizePrincipal(server, identity);
    const seq = server.currentSeq();
    server.pull(identity.actor, { clientId: identity.clientId, branchId: "main", since: seq });
    if (identity.mode === "hosted" && identity.expiresAt <= Date.now())
      throw new RequestError("Workspace identity has expired", 403);
    return seq;
  }

  private async authorizedSocket(socket: WebSocket, server: SyncServer): Promise<SocketIdentity | null> {
    try {
      const identity = socketIdentity.parse(socket.deserializeAttachment());
      await this.authorizeSocket(server, identity);
      return identity;
    } catch {
      this.closeSocket(socket, 1008, "Workspace access is no longer available");
      return null;
    }
  }

  private queueBroadcast() {
    if (this.broadcastQueued) return;
    this.broadcastQueued = true;
    queueMicrotask(() => {
      this.ctx.waitUntil(
        this.broadcast().finally(() => {
          this.broadcastQueued = false;
          if (this.server && this.server.currentSeq() > this.lastBroadcastSeq) this.queueBroadcast();
        }),
      );
    });
  }

  private async broadcast() {
    const server = this.server;
    if (!server || mode(this.env) === "disabled") return;
    const seq = server.currentSeq();
    if (seq <= this.lastBroadcastSeq) return;
    this.lastBroadcastSeq = seq;
    const poke = JSON.stringify({ type: "poke", seq } satisfies Poke);
    for (const socket of this.ctx.getWebSockets()) {
      const identity = await this.authorizedSocket(socket, server);
      if (!identity) continue;
      if (identity.mode === "hosted" && identity.expiresAt <= Date.now()) {
        this.closeSocket(socket, 1008, "Workspace identity has expired");
        continue;
      }
      try {
        socket.send(poke);
      } catch {
        this.closeSocket(socket, 1011, "Workspace notification failed");
      }
    }
  }

  private async upgradeSocket(request: Request, server: SyncServer, url: URL): Promise<Response> {
    const input = query(connectQuery, url);
    validateUpgrade(request, this.env);
    const identity = socketIdentity.parse({
      ...this.principal(request),
      clientId: input.clientId,
      branchId: input.branchId,
    });
    if (input.admissionId !== undefined && (identity.mode !== "hosted" || input.admissionId !== identity.admissionId))
      throw new RequestError("Workspace admission has changed; reload this page", 403);
    const seq = await this.authorizeSocket(server, identity);
    const pair = new WebSocketPair();
    const socket = pair[1];
    this.ctx.acceptWebSocket(socket);
    socket.serializeAttachment(identity);
    socket.send(JSON.stringify({ type: "poke", seq } satisfies Poke));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private closeSocket(socket: WebSocket, code: number, reason: string) {
    try {
      socket.close(code, reason);
    } catch {
      // The peer may already have completed the close handshake.
    }
  }

  override webSocketMessage(socket: WebSocket): void {
    this.closeSocket(socket, 1008, "Client messages are not supported");
  }

  override webSocketClose(socket: WebSocket): void {
    this.closeSocket(socket, 1000, "Connection closed");
  }

  override webSocketError(socket: WebSocket): void {
    this.closeSocket(socket, 1011, "Workspace connection failed");
  }

  private async document(request: Request, server: SyncServer, url: URL): Promise<Response> {
    const identity = z.uuidv7();
    const input: { issueId: string; incarnation: string; update?: string } =
      request.method === "GET"
        ? query(z.strictObject({ issueId: identity, incarnation: z.string().min(1) }), url)
        : await body(
            z.strictObject({ issueId: identity, incarnation: z.string().min(1), update: z.string() }),
            request,
          );
    const operation = this.documentOperation
      .catch(() => {})
      .then(async () => {
        const authorize = async () => {
          const context = await this.requestContext(request, server);
          if (context.actor.type !== "user") throw new RequestError("Only people may edit descriptions", 403);
          const issue = requireIssue(
            {
              store: server.store,
              actor: context.actor,
              actorId: context.actor.id,
              now: new Date().toISOString(),
              server: true,
            },
            input.issueId,
          );
          if (issue.trashed || issue.archivedAt) throw new RequestError("Issue is not available", 404);
          if (issueIncarnation(issue) !== input.incarnation)
            throw new RequestError("Issue was replaced; reload before editing its description", 409);
          return { context, issue };
        };
        const { context, issue } = await authorize();
        const incarnation = issueIncarnation(issue);
        const principal = this.principal(request);
        const document = this.env.DOCUMENTS.getByName(documentName(context.workspaceId, issue.id, incarnation));
        const synchronize = async (update?: string) => {
          try {
            const state = await document.synchronize(
              context.workspaceId,
              issue.id,
              incarnation,
              context.actor,
              issue.description ?? "",
              update,
              principal.mode === "hosted" ? principal.expiresAt : undefined,
            );
            // Reauthorize after RPC. Publishing a prior durable edit before the next write preserves
            // its editor if an earlier request committed the body but failed to publish its mirror.
            const current = await authorize();
            if (current.issue.createdSeq !== issue.createdSeq || current.issue.createdAt !== issue.createdAt)
              throw new RequestError("Issue was replaced during document synchronization", 409);
            server.commitDocument(
              current.context.actor,
              { id: issue.id, description: state.mirror, contentState: state.contentState },
              state.editor,
            );
            return state;
          } catch (error) {
            if (error instanceof Error && error.message.includes("Invalid document update"))
              throw new RequestError("Invalid document update");
            if (error instanceof Error && error.message.includes("Document authorization expired"))
              throw new RequestError("Workspace identity has expired", 403);
            throw error;
          }
        };
        let state = await synchronize();
        if (input.update !== undefined) state = await synchronize(input.update);
        return json({ update: state.update, mirror: state.mirror, contentState: state.contentState, incarnation });
      });
    this.documentOperation = operation;
    return operation;
  }

  override async fetch(request: Request): Promise<Response> {
    if (mode(this.env) === "disabled") return disabled();
    await this.ready;
    if (this.env.BACKUP_RESTORE_ISOLATED === "true" && (await this.ctx.storage.get("restore-progress")) !== "complete")
      return json({ error: "Isolated restore is not complete" }, 503);
    try {
      const server = this.server;
      if (!server) throw new Error("Workspace initialization did not complete");
      const url = new URL(request.url);
      const method = routes.get(url.pathname);
      if (!method) return json({ error: "Not found" }, 404);
      if (!method.split(", ").includes(request.method))
        return json({ error: "Method not allowed" }, 405, { allow: method });
      if (request.method === "POST" && url.search) throw new RequestError("Unexpected query parameters");
      if (mode(this.env) === "hosted" && request.method === "POST") requireHostedOrigin(request, this.env);
      if (url.pathname === "/__local/seed") {
        if (mode(this.env) !== "local") return json({ error: "Not found" }, 404);
        const input = await body(seedBody, request);
        return json(seedWorkspace(server, this.driver, input.seedIssue));
      }
      if (url.pathname === "/sync/connect") return await this.upgradeSocket(request, server, url);
      if (url.pathname === "/sync/document") return await this.document(request, server, url);
      if (url.pathname.startsWith("/api/") && url.pathname !== "/api/context") {
        if (mode(this.env) !== "hosted") return json({ error: "Not found" }, 404);
        const input =
          request.method === "GET"
            ? query(z.strictObject({}), url)
            : await body(z.record(z.string(), z.unknown()), request);
        const context = await this.requestContext(request, server);
        if (context.role !== "owner") throw new RequestError("Only the workspace owner may manage members", 403);
        const principal = readPrincipal(request);
        if (url.pathname === "/api/members") {
          const result = await listMembership(this.env, principal);
          await this.requestContext(request, server);
          return json({
            ...result,
            members: result.members.map((member) => {
              const local = server.store.get("user", member.userId);
              return {
                ...member,
                active: member.active && (local === undefined || (local.active && !local.archivedAt)),
              };
            }),
          });
        }
        if (url.pathname === "/api/invitations") {
          const value = z
            .strictObject({
              email: z.email().transform((email) => email.toLowerCase()),
              expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
            })
            .parse(input);
          const expiresAt = value.expiresAt ? new Date(value.expiresAt).toISOString() : null;
          return json(await createInvitation(this.env, principal, value.email, expiresAt));
        }
        if (url.pathname === "/api/invitations/revoke") {
          const { id } = z.strictObject({ id: z.uuidv7() }).parse(input);
          await revokeInvitation(this.env, principal, id);
          return json({ ok: true });
        }
        const { userId } = z.strictObject({ userId: z.uuidv7() }).parse(input);
        const removal = await removeMembership(this.env, principal, userId);
        for (const socket of this.ctx.getWebSockets()) {
          const identity = socketIdentity.safeParse(socket.deserializeAttachment());
          if (
            identity.success &&
            identity.data.mode === "hosted" &&
            identity.data.actor.id === userId &&
            identity.data.admissionId === removal.admissionId
          )
            this.closeSocket(socket, 1008, "Workspace access is no longer available");
        }
        projectMembershipRemoval(server, removal);
        return json({ ok: true });
      }
      // Read a streaming body before the final membership/expiry check.
      if (url.pathname === "/sync/push") {
        const input = await body(pushBody, request);
        const { actor } = await this.requestContext(request, server);
        return json(
          server.push(actor, {
            ...input,
            mutations: input.mutations.map(({ reason, causationSeq, ...mutation }) => ({
              ...mutation,
              ...(reason === undefined ? {} : { reason }),
              ...(causationSeq === undefined ? {} : { causationSeq }),
            })),
          }),
        );
      }
      if (url.pathname === "/sync/branch/create") {
        const input = await body(createBody, request);
        const { actor } = await this.requestContext(request, server);
        return json(server.createBranch(actor, input));
      }
      if (url.pathname === "/sync/branch/merge") {
        const input = await body(mergeBody, request);
        const { actor } = await this.requestContext(request, server);
        return json(server.mergeBranch(actor, input));
      }
      const context = await this.requestContext(request, server);
      const { actor } = context;
      switch (url.pathname) {
        case "/api/context":
          query(z.strictObject({}), url);
          return json(context);
        case "/sync/bootstrap": {
          const input = query(bootstrapQuery, url);
          return json(server.bootstrap(actor, input.clientId, input.branchId));
        }
        case "/sync/pull":
          return json(server.pull(actor, query(pullQuery, url)));
        case "/sync/load":
          return json(server.load(actor, query(loadQuery, url)));
        case "/sync/branch/get":
          return json(server.getBranch(actor, query(branchQuery, url).branchId));
        case "/sync/branch/preview":
          return json(server.previewBranch(actor, query(branchQuery, url).branchId));
        case "/sync/events": {
          const { entityId, issueId, before, ...input } = query(eventsQuery, url);
          return json(
            server.events(actor, {
              ...input,
              ...(entityId === undefined ? {} : { entityId }),
              ...(issueId === undefined ? {} : { issueId }),
              ...(before === undefined ? {} : { before }),
            }),
          );
        }
        case "/sync/activity": {
          const { model, rowId, actorType, txnId, before, ...input } = query(activityQuery, url);
          return json(
            server.activity(actor, {
              ...input,
              ...(model === undefined ? {} : { model }),
              ...(rowId === undefined ? {} : { rowId }),
              ...(actorType === undefined ? {} : { actorType }),
              ...(txnId === undefined ? {} : { txnId }),
              ...(before === undefined ? {} : { before }),
            }),
          );
        }
        default:
          return json({ error: "Not found" }, 404);
      }
    } catch (error) {
      return failure(error);
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const runtimeMode = mode(env);
      const url = new URL(request.url);
      if (runtimeMode === "disabled") return disabled();
      if (runtimeMode === "local") {
        if (
          env.BACKUP_RESTORE_ISOLATED === "true" &&
          !(await env.WORKSPACES.getByName("local").restoreComplete("local"))
        )
          return json({ error: "Isolated restore is not complete" }, 503);
        if (url.pathname === "/api/context") {
          if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, { allow: "GET" });
          query(z.strictObject({}), url);
          return json(localContext(selectedActor(request)));
        }
        if (!syncRoute(url.pathname) && !localRoute(url.pathname)) return json({ error: "Not found" }, 404);
        return env.WORKSPACES.getByName("local").fetch(request);
      }
      if (localRoute(url.pathname)) return json({ error: "Not found" }, 404);
      const identity = await verifyAccess(request, env);
      if (env.BACKUP_RESTORE_ISOLATED === "true") {
        const workspaceId = configuration(env).workspaceId;
        if (!(await env.WORKSPACES.getByName(workspaceId).restoreComplete(workspaceId)))
          return json({ error: "Isolated restore is not complete" }, 503);
      }
      if (request.method === "POST" || url.pathname === "/sync/connect") requireHostedOrigin(request, env);
      if (url.pathname === "/api/invitations/inspect" || url.pathname === "/api/invitations/accept") {
        if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { allow: "POST" });
        query(z.strictObject({}), url);
        const { token } = await body(z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }), request);
        if (url.pathname.endsWith("/inspect")) return json(await inspectInvitation(env, identity, token));
        const principal = await acceptInvitation(env, identity, token);
        const target = new URL("/api/context", url);
        return env.WORKSPACES.getByName(principal.workspaceId).fetch(
          forwardedRequest(new Request(target, { headers: request.headers }), principal),
        );
      }
      if (url.pathname.startsWith("/api/") || syncRoute(url.pathname)) {
        const principal = await admitMember(env, identity);
        const expected = request.headers.get("X-Kanbun-Admission");
        if (expected !== null && expected !== principal.admissionId)
          throw new RequestError("Workspace admission has changed; reload this page", 403);
        return env.WORKSPACES.getByName(principal.workspaceId).fetch(forwardedRequest(request, principal));
      }
      return env.ASSETS ? env.ASSETS.fetch(request) : json({ error: "Not found" }, 404);
    } catch (error) {
      return failure(error);
    }
  },
} satisfies ExportedHandler<Env>;
