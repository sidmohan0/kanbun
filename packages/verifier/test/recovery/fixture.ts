import { test as base, expect } from "@playwright/test";
import { uuidv7 } from "@kanbun/model";
import type { Actor, PushRequest, PushResponse } from "@kanbun/sync";
import type { SyncServer } from "@kanbun/sync/server";
import { startWorkspaceRuntime } from "@kanbun/worker/testing";
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
type WorkspaceRuntime = Awaited<ReturnType<typeof startWorkspaceRuntime>>;
type Inspection = Awaited<ReturnType<WorkspaceRuntime["inspect"]>>;

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

export type MergeObservation = {
  request: Parameters<SyncServer["mergeBranch"]>[1];
  rawBody: string;
  actor: Actor;
  result: ReturnType<SyncServer["mergeBranch"]>;
  seqBefore: number;
  seqAfter: number;
  responseDropped: boolean;
};

export type RecoveryHarness = {
  origin: string;
  teamId: string;
  issueId: string;
  actors: typeof actors;
  pushes: PushObservation[];
  merges: MergeObservation[];
  createBranch(owner?: ActorName): Promise<string>;
  dropNextPushResponse(actor?: ActorName): void;
  dropNextMergeResponse(actor?: ActorName): void;
  restart: WorkspaceRuntime["restart"];
  inspect: WorkspaceRuntime["inspect"];
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

function currentSeq(inspection: Inspection, branchId = "main") {
  return inspection.log.reduce(
    (seq, entry) =>
      entry["branch_id"] === "main" || entry["branch_id"] === branchId ? Math.max(seq, Number(entry["seq"])) : seq,
    0,
  );
}

async function createHarness(seedIssue: boolean) {
  const temporary = await mkdtemp(path.join(tmpdir(), "kanbun-browser-recovery-"));
  const runtime = await startWorkspaceRuntime({ localDev: true });
  const { teamId, issueId } = await runtime.seed(seedIssue);
  const pushes: PushObservation[] = [];
  const merges: MergeObservation[] = [];
  let dropActor: ActorName | undefined;
  let dropMergeActor: ActorName | undefined;
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
        // The fixture cookie selects the Worker's explicitly enabled local actor mode.
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
        const rawBody = request.method === "POST" ? await body(request) : undefined;
        const observingPush = url.pathname === "/sync/push" && request.method === "POST";
        const observingMerge = url.pathname === "/sync/branch/merge" && request.method === "POST";
        const before = observingPush || observingMerge ? await runtime.inspect() : undefined;
        const upstream = await runtime.fetch(url.pathname + url.search, {
          method: request.method ?? "GET",
          headers: {
            "X-Kanbun-Local-Actor": selected,
            ...(request.headers["content-type"] ? { "content-type": request.headers["content-type"] } : {}),
          },
          ...(rawBody === undefined ? {} : { body: rawBody }),
        });
        const payload = await upstream.text();
        let responseDropped = false;
        if (observingPush) {
          const push = JSON.parse(rawBody!) as PushRequest;
          const result = JSON.parse(payload) as PushResponse;
          responseDropped = dropActor === selected && upstream.ok && result.ok;
          pushes.push({
            request: push,
            rawBody: rawBody!,
            actor: actors[selected],
            cookie,
            requestContentType: request.headers["content-type"] ?? "",
            result,
            seqBefore: currentSeq(before!, push.branchId),
            seqAfter: currentSeq(await runtime.inspect(), push.branchId),
            responseDropped,
          });
          if (responseDropped) dropActor = undefined;
        }
        if (observingMerge) {
          const merge = JSON.parse(rawBody!) as MergeObservation["request"];
          const result = JSON.parse(payload) as MergeObservation["result"];
          responseDropped = dropMergeActor === selected && upstream.ok && result.ok;
          merges.push({
            request: merge,
            rawBody: rawBody!,
            actor: actors[selected],
            result,
            seqBefore: currentSeq(before!),
            seqAfter: currentSeq(await runtime.inspect()),
            responseDropped,
          });
          if (responseDropped) dropMergeActor = undefined;
        }
        if (responseDropped) {
          // The real Worker has committed. Only its browser-facing acknowledgement is lost.
          response.writeHead(upstream.status, {
            "content-type": upstream.headers.get("content-type") ?? "application/json",
            "content-length": Buffer.byteLength(payload),
          });
          response.write(payload.slice(0, Math.floor(payload.length / 2)), () =>
            setImmediate(() => response.destroy()),
          );
          return;
        }
        // Node fetch has decoded the upstream body; emit fresh transport framing for these bytes.
        const headers = new Headers(upstream.headers);
        for (const header of ["content-encoding", "content-length", "transfer-encoding"]) headers.delete(header);
        response.writeHead(upstream.status, Object.fromEntries(headers));
        response.end(payload);
        return;
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
    actors,
    pushes,
    merges,
    async createBranch(owner = "alice") {
      const id = uuidv7();
      const response = await runtime.fetch("/sync/branch/create", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Kanbun-Local-Actor": owner },
        body: JSON.stringify({ id, name: "Recovery proposal", scope: { teamIds: [teamId], projectIds: [] } }),
      });
      if (!response.ok) throw new Error(`Fixture branch creation failed: ${response.status} ${await response.text()}`);
      return id;
    },
    dropNextPushResponse(actor = "alice") {
      dropActor = actor;
    },
    dropNextMergeResponse(actor = "alice") {
      dropMergeActor = actor;
    },
    restart: () => runtime.restart(),
    inspect: () => runtime.inspect(),
  };
  return {
    harness,
    async close() {
      await new Promise<void>((resolve, reject) => http.close((error) => (error ? reject(error) : resolve())));
      await vite.close();
      await runtime.close();
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
            body: JSON.stringify(
              {
                database: await fixture.harness.inspect(),
                pushes: fixture.harness.pushes,
                merges: fixture.harness.merges,
              },
              null,
              2,
            ),
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
