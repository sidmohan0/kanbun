import { DurableObject } from "cloudflare:workers";
import migrations from "@kanbun/model/migrations/workspace/migrations.js";
import { mutators } from "@kanbun/mutators";
import { MutationError, type Actor, type Poke, type WorkspaceContext } from "@kanbun/sync";
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
import { activeOwner, admitOwner, type DirectoryEnvironment } from "./directory";
import { localActors, seedWorkspace } from "./local";
import { preparePreview } from "./preview";
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
  ASSETS?: Fetcher;
}

const routes = new Map<string, string>(
  Object.entries({
    "/api/context": "GET",
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
  console.error("Workspace request failed", error);
  return json({ error: "Internal workspace error" }, 500);
}

/** The authority is reached through the edge Worker's private binding, never a public DO URL. */
export class WorkspaceDO extends DurableObject<Env> {
  private readonly ready: Promise<void>;
  private readonly driver: SqlDriver;
  private server: SyncServer | undefined;
  private broadcastQueued = false;
  private lastBroadcastSeq = 0;

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
      server.onCommit(() => this.queueBroadcast());
      for (const socket of ctx.getWebSockets()) await this.authorizedSocket(socket, server);
    });
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
      principal.mode === "hosted" ? await activeOwner(this.env, principal) : localContext(principal.actor);
    if (principal.mode === "hosted") preparePreview(server, this.driver, context);
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

  override async fetch(request: Request): Promise<Response> {
    if (mode(this.env) === "disabled") return disabled();
    await this.ready;
    try {
      const server = this.server;
      if (!server) throw new Error("Workspace initialization did not complete");
      const url = new URL(request.url);
      const method = routes.get(url.pathname);
      if (!method) return json({ error: "Not found" }, 404);
      if (request.method !== method) return json({ error: "Method not allowed" }, 405, { allow: method });
      if (request.method === "POST" && url.search) throw new RequestError("Unexpected query parameters");
      if (mode(this.env) === "hosted" && request.method === "POST") requireHostedOrigin(request, this.env);
      if (url.pathname === "/__local/seed") {
        if (mode(this.env) !== "local") return json({ error: "Not found" }, 404);
        const input = await body(seedBody, request);
        return json(seedWorkspace(server, this.driver, input.seedIssue));
      }
      if (url.pathname === "/sync/connect") return await this.upgradeSocket(request, server, url);
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
          const { entityId, ...input } = query(eventsQuery, url);
          return json(server.events(actor, { ...input, ...(entityId === undefined ? {} : { entityId }) }));
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
      if (request.method === "POST" || url.pathname === "/sync/connect") requireHostedOrigin(request, env);
      if (url.pathname === "/api/context" || syncRoute(url.pathname)) {
        const principal = await admitOwner(env, identity);
        return env.WORKSPACES.getByName(principal.workspaceId).fetch(forwardedRequest(request, principal));
      }
      return env.ASSETS ? env.ASSETS.fetch(request) : json({ error: "Not found" }, 404);
    } catch (error) {
      return failure(error);
    }
  },
} satisfies ExportedHandler<Env>;
