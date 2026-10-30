import { test as base, expect } from "@playwright/test";
import { uuidv7, type Row } from "@kanbun/model";
import { mutators } from "@kanbun/mutators";
import type { Actor, PushRequest, PushResponse } from "@kanbun/sync";
import { SyncServer } from "@kanbun/sync/server";
import { openWorkspaceDb } from "@kanbun/sync/server/node";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { actors, type ActorName } from "./contract";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../../../..");
const actorCookie = "kanbun_fixture_actor";

export type PushObservation = {
  request: PushRequest;
  rawBody: string;
  actor: Actor;
  cookie: string;
  requestContentType: string;
  result: PushResponse;
  seqBefore: number;
  seqAfter: number;
  responseDropped: boolean;
};

export type RecoveryHarness = {
  origin: string;
  teamId: string;
  issueId: string;
  databasePath: string;
  actors: typeof actors;
  pushes: PushObservation[];
  createBranch(owner?: ActorName): string;
  dropNextPushResponse(actor?: ActorName): void;
  restart(): Promise<void>;
  inspect(): {
    seq: number;
    issues: Row<"issue">[];
    clients: Record<string, unknown>[];
    log: Record<string, unknown>[];
  };
};

async function body(request: IncomingMessage): Promise<string> {
  let text = "";
  for await (const chunk of request) text += String(chunk);
  return text;
}

function json(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function createHarness(seedIssue: boolean) {
  const temporary = await mkdtemp(path.join(tmpdir(), "kanbun-browser-recovery-"));
  const databasePath = path.join(temporary, "workspace.sqlite");
  const teamId = uuidv7();
  const issueId = uuidv7();
  const open = () => {
    const { db, driver } = openWorkspaceDb(databasePath);
    return { db, driver, server: new SyncServer({ driver, mutators }) };
  };
  let active = open();
  active.server.system("workspaceInit", {
    organization: { id: uuidv7(), name: "Recovery fixture", urlKey: "recovery-fixture" },
    owner: { id: actors.alice.id, name: "Alice", email: "alice@example.com" },
  });
  active.server.system("memberSync", { id: actors.bob.id, name: "Bob", email: "bob@example.com" });
  const mutations: PushRequest["mutations"] = [
    {
      id: 1,
      name: "teamCreate",
      args: {
        id: teamId,
        name: "Recovery",
        key: "REC",
        membershipId: uuidv7(),
        stateIds: { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() },
      },
      ts: new Date().toISOString(),
    },
    {
      id: 2,
      name: "teamMembershipCreate",
      args: { id: uuidv7(), teamId, userId: actors.bob.id },
      ts: new Date().toISOString(),
    },
  ];
  if (seedIssue)
    mutations.push({
      id: 3,
      name: "issueCreate",
      args: { id: issueId, teamId, title: "Shared issue", subscriptionId: uuidv7() },
      ts: new Date().toISOString(),
    });
  const seeded = active.server.push(actors.alice, { clientId: "fixture-seed", mutations });
  if (!seeded.ok || seeded.rejected.length) throw new Error(`Fixture seed failed: ${JSON.stringify(seeded)}`);

  const pushes: PushObservation[] = [];
  let dropActor: ActorName | undefined;
  const vite = await createViteServer({
    configFile: false,
    root: directory,
    cacheDir: path.join(temporary, "vite-cache"),
    appType: "custom",
    server: {
      middlewareMode: true,
      hmr: false,
      ws: false,
      fs: { allow: [repository, path.join(temporary, "vite-cache")] },
    },
  });
  const http = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/fixture/session" && request.method === "POST") {
        const selected = JSON.parse(await body(request)) as { actor?: ActorName };
        if (selected.actor !== "alice" && selected.actor !== "bob")
          return json(response, { error: "fixture actor missing" }, 400);
        // This cookie selects a synthetic fixture actor; it is not product authentication.
        response.setHeader("set-cookie", `${actorCookie}=${selected.actor}; Path=/; HttpOnly; SameSite=Lax`);
        return json(response, actors[selected.actor]);
      }
      if (url.pathname.startsWith("/sync/")) {
        const cookie = request.headers.cookie ?? "";
        const selected = cookie
          .split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith(`${actorCookie}=`))
          ?.slice(actorCookie.length + 1);
        if (selected !== "alice" && selected !== "bob")
          return json(response, { error: "fixture actor cookie missing" }, 401);
        const actor = actors[selected];
        if (url.pathname === "/sync/bootstrap")
          return json(
            response,
            active.server.bootstrap(
              actor,
              url.searchParams.get("clientId") ?? "",
              url.searchParams.get("branchId") ?? "main",
            ),
          );
        if (url.pathname === "/sync/pull")
          return json(
            response,
            active.server.pull(actor, {
              clientId: url.searchParams.get("clientId") ?? "",
              since: Number(url.searchParams.get("since")),
              branchId: url.searchParams.get("branchId") ?? "main",
            }),
          );
        if (url.pathname === "/sync/load")
          return json(
            response,
            active.server.load(actor, {
              model: url.searchParams.get("model") as Parameters<SyncServer["load"]>[1]["model"],
              parentId: url.searchParams.get("parentId") ?? "",
              branchId: url.searchParams.get("branchId") ?? "main",
            }),
          );
        if (url.pathname === "/sync/push" && request.method === "POST") {
          const rawBody = await body(request);
          const push = JSON.parse(rawBody) as PushRequest;
          const seqBefore = active.server.currentSeq(push.branchId);
          const result = active.server.push(actor, push);
          const responseDropped = dropActor === selected && result.ok;
          pushes.push({
            request: push,
            rawBody,
            actor,
            cookie,
            requestContentType: request.headers["content-type"] ?? "",
            result,
            seqBefore,
            seqAfter: active.server.currentSeq(push.branchId),
            responseDropped,
          });
          if (responseDropped) {
            dropActor = undefined;
            const payload = JSON.stringify(result);
            response.writeHead(200, {
              "content-type": "application/json; charset=utf-8",
              "content-length": Buffer.byteLength(payload),
            });
            response.write(payload.slice(0, Math.floor(payload.length / 2)), () => {
              setImmediate(() => response.destroy());
            });
            return;
          }
          return json(response, result);
        }
        return json(response, { error: "unknown sync fixture route" }, 404);
      }
      if (url.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(await readFile(path.join(directory, "index.html")));
        return;
      }
      vite.middlewares(request, response, () => json(response, { error: "fixture asset missing" }, 404));
    })().catch((error: unknown) =>
      json(response, { error: error instanceof Error ? error.message : String(error) }, 500),
    );
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("Fixture HTTP listener did not start.");
  const harness: RecoveryHarness = {
    origin: `http://127.0.0.1:${address.port}`,
    teamId,
    issueId,
    databasePath,
    actors,
    pushes,
    createBranch(owner = "alice") {
      const id = uuidv7();
      active.server.createBranch(actors[owner], {
        id,
        name: "Recovery proposal",
        scope: { teamIds: [teamId], projectIds: [] },
      });
      return id;
    },
    dropNextPushResponse(actor = "alice") {
      dropActor = actor;
    },
    async restart() {
      active.db.close();
      active = open();
    },
    inspect() {
      return {
        seq: active.server.currentSeq(),
        issues: active.server.store.list("issue"),
        clients: active.driver.all(
          "SELECT client_id, user_id, branch_id, last_mutation_id FROM sync_client ORDER BY client_id",
        ),
        log: active.driver.all("SELECT * FROM sync_log ORDER BY seq"),
      };
    },
  };
  return {
    harness,
    async close() {
      await new Promise<void>((resolve, reject) => http.close((error) => (error ? reject(error) : resolve())));
      await vite.close();
      active.db.close();
      await rm(temporary, { recursive: true, force: true });
    },
  };
}

export const test = base.extend<{ seedIssue: boolean; harness: RecoveryHarness }>({
  seedIssue: [true, { option: true }],
  harness: async ({ seedIssue }, use, testInfo) => {
    const fixture = await createHarness(seedIssue);
    try {
      await use(fixture.harness);
    } finally {
      try {
        if (testInfo.status !== testInfo.expectedStatus) {
          await testInfo.attach("recovery-server-state", {
            body: JSON.stringify({ database: fixture.harness.inspect(), pushes: fixture.harness.pushes }, null, 2),
            contentType: "application/json",
          });
        }
      } finally {
        await fixture.close();
      }
    }
  },
});

export { expect };

export const syncApi = (url: URL) => url.pathname.startsWith("/sync/");
