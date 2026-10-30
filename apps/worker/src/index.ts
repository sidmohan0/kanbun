import { DurableObject } from "cloudflare:workers";
import migrations from "@kanbun/model/migrations/workspace/migrations.js";
import { mutators } from "@kanbun/mutators";
import { MutationError, type Actor } from "@kanbun/sync";
import { durableObjectDriver, SyncServer, type SqlDriver } from "@kanbun/sync/server";
import { z } from "zod";
import { localActors, seedWorkspace } from "./local";
import {
  activityQuery,
  body,
  bootstrapQuery,
  branchQuery,
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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.driver = durableObjectDriver(ctx.storage);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      if (env.LOCAL_DEV === "true") this.server = new SyncServer({ driver: this.driver, mutators, migrations });
    });
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
      const member = server.store.get("user", actor.id);
      if (!member?.active || member.archivedAt) throw new MutationError("Local member is not active", "forbidden");
      switch (url.pathname) {
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
