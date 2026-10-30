import { DurableObject } from "cloudflare:workers";
import migrations from "@kanbun/model/migrations/workspace/migrations.js";
import { mutators } from "@kanbun/mutators";
import { MutationError, type Actor, type Poke } from "@kanbun/sync";
import { durableObjectDriver, SyncServer, type SqlDriver } from "@kanbun/sync/server";
import { z } from "zod";
import { localActors, seedWorkspace } from "./local";
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

export interface Env {
  WORKSPACES: DurableObjectNamespace<WorkspaceDO>;
  LOCAL_DEV?: string;
}

const routes = new Map<string, string>(
  Object.entries({
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

const socketIdentity = z.strictObject({
  actor: z.strictObject({ id: z.enum([localActors.alice.id, localActors.bob.id]), type: z.literal("user") }),
  clientId: z.string().min(1),
  branchId: z.literal("main"),
});
type SocketIdentity = z.infer<typeof socketIdentity>;

function json(value: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function disabled() {
  return json({ error: "Local workspace routes are disabled; production authentication is not configured" }, 503);
}

function localRoute(path: string) {
  return path.startsWith("/sync/") || path.startsWith("/__local/");
}

function selectedActor(request: Request): Actor {
  const name = request.headers.get("X-Kanbun-Local-Actor") ?? "alice";
  if (name !== "alice" && name !== "bob") throw new RequestError("Unknown local actor", 401);
  return localActors[name];
}

function validateUpgrade(request: Request) {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
    throw new RequestError("Expected a WebSocket upgrade", 426);
  const origin = request.headers.get("Origin");
  const expected = new URL(request.url);
  if (expected.protocol === "ws:") expected.protocol = "http:";
  if (expected.protocol === "wss:") expected.protocol = "https:";
  // Browser connections must originate from this local app. Node clients do
  // not send Origin; they still use the fixed, explicitly enabled local mode.
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
  console.error("Local workspace request failed", error);
  return json({ error: "Internal workspace error" }, 500);
}

/** One local workspace authority using the same engine and migrations as repository checks. */
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
      if (env.LOCAL_DEV !== "true") {
        for (const socket of ctx.getWebSockets()) this.closeSocket(socket, 1008, "Local workspace routes are disabled");
        return;
      }
      const server = new SyncServer({ driver: this.driver, mutators, migrations });
      this.server = server;
      this.lastBroadcastSeq = server.currentSeq();
      server.onCommit(() => this.queueBroadcast());
      // Hibernating sockets remain accepted by the runtime when this instance
      // is recreated. Their attachment, not an in-memory array, is the identity.
      for (const socket of ctx.getWebSockets()) this.authorizedSocket(socket, server);
    });
  }

  private requireActiveMember(server: SyncServer, actor: Actor) {
    const member = server.store.get("user", actor.id);
    if (!member?.active || member.archivedAt) throw new MutationError("Local member is not active", "forbidden");
  }

  private authorizeSocket(server: SyncServer, identity: SocketIdentity): number {
    this.requireActiveMember(server, identity.actor);
    const seq = server.currentSeq();
    // Pull binds the actor/client/main identity and rechecks it without replacing
    // the client's bootstrap visibility checkpoint or returning rows on the socket.
    server.pull(identity.actor, { clientId: identity.clientId, branchId: "main", since: seq });
    return seq;
  }

  private authorizedSocket(socket: WebSocket, server: SyncServer): boolean {
    try {
      this.authorizeSocket(server, socketIdentity.parse(socket.deserializeAttachment()));
      return true;
    } catch {
      this.closeSocket(socket, 1008, "Workspace access is no longer available");
      return false;
    }
  }

  private queueBroadcast() {
    if (this.broadcastQueued) return;
    this.broadcastQueued = true;
    queueMicrotask(() => {
      this.broadcastQueued = false;
      const server = this.server;
      if (!server || this.env.LOCAL_DEV !== "true") return;
      // The local seed can contain nested transactions. Re-read only after its
      // synchronous outer transaction has committed (or rolled back).
      const seq = server.currentSeq();
      if (seq <= this.lastBroadcastSeq) return;
      this.lastBroadcastSeq = seq;
      const poke = JSON.stringify({ type: "poke", seq } satisfies Poke);
      for (const socket of this.ctx.getWebSockets()) {
        if (!this.authorizedSocket(socket, server)) continue;
        try {
          socket.send(poke);
        } catch {
          this.closeSocket(socket, 1011, "Workspace notification failed");
        }
      }
    });
  }

  private upgradeSocket(request: Request, server: SyncServer, actor: Actor, url: URL): Response {
    const input = query(connectQuery, url);
    validateUpgrade(request);
    const identity = socketIdentity.parse({ actor, clientId: input.clientId, branchId: input.branchId });
    const seq = this.authorizeSocket(server, identity);
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
    if (this.env.LOCAL_DEV !== "true") return disabled();
    await this.ready;
    try {
      const server = this.server;
      if (!server) throw new Error("Workspace initialization did not complete");
      const url = new URL(request.url);
      const method = routes.get(url.pathname);
      if (!method) return json({ error: "Not found" }, 404);
      if (request.method !== method) return json({ error: "Method not allowed" }, 405, { allow: method });
      if (request.method === "POST" && url.search) throw new RequestError("Unexpected query parameters");
      if (url.pathname === "/__local/seed") {
        const input = await body(seedBody, request);
        return json(seedWorkspace(server, this.driver, input.seedIssue));
      }
      const actor = selectedActor(request);
      this.requireActiveMember(server, actor);
      switch (url.pathname) {
        case "/sync/connect":
          return this.upgradeSocket(request, server, actor, url);
        case "/sync/bootstrap": {
          const input = query(bootstrapQuery, url);
          return json(server.bootstrap(actor, input.clientId, input.branchId));
        }
        case "/sync/pull":
          return json(server.pull(actor, query(pullQuery, url)));
        case "/sync/load":
          return json(server.load(actor, query(loadQuery, url)));
        case "/sync/push": {
          const input = await body(pushBody, request);
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
        case "/sync/branch/create":
          return json(server.createBranch(actor, await body(createBody, request)));
        case "/sync/branch/get":
          return json(server.getBranch(actor, query(branchQuery, url).branchId));
        case "/sync/branch/preview":
          return json(server.previewBranch(actor, query(branchQuery, url).branchId));
        case "/sync/branch/merge":
          return json(server.mergeBranch(actor, await body(mergeBody, request)));
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
    if (!localRoute(new URL(request.url).pathname)) return json({ error: "Not found" }, 404);
    if (env.LOCAL_DEV !== "true") return disabled();
    return env.WORKSPACES.getByName("local").fetch(request);
  },
} satisfies ExportedHandler<Env>;
