import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { describe, expect, it } from "vitest";
import type { Mutation, PushResponse } from "@kanbun/sync";
import { startWorkspaceRuntime } from "./runtime";
import { connectTestSocket } from "./socket-client";

type Runtime = Awaited<ReturnType<typeof startWorkspaceRuntime>>;
const id = (n: number) => `019a0000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const command = (mutationId: number, issueId: string, title: string): Mutation => ({
  id: mutationId,
  name: "issueUpdate",
  args: { id: issueId, patch: { title } },
  ts: "2026-10-30T12:00:00.000Z",
});

async function json<T>(runtime: Runtime, path: string, body?: unknown): Promise<T> {
  const response = await runtime.fetch(
    path,
    body === undefined
      ? undefined
      : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  );
  expect(response.status).toBe(200);
  return (await response.json()) as T;
}

async function push(runtime: Runtime, clientId: string, mutations: Mutation[], branchId?: string) {
  const result = await json<PushResponse>(runtime, "/sync/push", {
    clientId,
    mutations,
    ...(branchId === undefined ? {} : { branchId }),
  });
  if (!result.ok) throw new Error(`Worker push failed: ${result.error}`);
  return result;
}

async function connect(runtime: Runtime, clientId: string) {
  const result = await connectTestSocket(runtime.origin, `/sync/connect?clientId=${encodeURIComponent(clientId)}`);
  if (!result.connection) throw new Error(`Worker WebSocket handshake failed (${result.status})`);
  const socket = result.connection;
  return {
    socket,
    messages: socket.messages,
    closed: socket.closed,
    async close() {
      if (socket.readyState !== WebSocket.CLOSED) socket.close();
      await socket.closed;
    },
  };
}

/** Exercise rejected HTTP upgrades and custom local headers without another WS dependency. */
function upgrade(runtime: Runtime, path: string, headers: Record<string, string> = {}) {
  return new Promise<number>((resolve, reject) => {
    const request = httpRequest(
      new URL(path, runtime.origin),
      {
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
          ...headers,
        },
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode ?? 0));
      },
    );
    request.once("upgrade", (response, socket) => {
      socket.destroy();
      resolve(response.statusCode ?? 0);
    });
    request.once("error", reject);
    request.end();
  });
}

describe("workspace WebSocket notifications in workerd", () => {
  it("sends only committed main cursors and preserves an accepted socket through hibernation", async () => {
    const runtime = await startWorkspaceRuntime();
    let connection: Awaited<ReturnType<typeof connect>> | undefined;
    try {
      const { issueId } = await runtime.seed();
      const baseline = (await runtime.inspect()).seq;
      connection = await connect(runtime, "ws-main-reader");
      const messages = connection.messages;
      await expect.poll(() => messages).toEqual([{ type: "poke", seq: baseline }]);
      // Connecting binds the client without silently replacing its bootstrap checkpoint.
      expect(await json(runtime, `/sync/pull?clientId=ws-main-reader&since=${baseline}`)).toMatchObject({
        reset: true,
      });

      const firstMutation = command(1, issueId, "Committed before hibernation");
      const first = await push(runtime, "ws-writer", [firstMutation]);
      await expect
        .poll(() => messages)
        .toEqual([
          { type: "poke", seq: baseline },
          { type: "poke", seq: first.seq },
        ]);
      expect(await push(runtime, "ws-writer", [firstMutation])).toMatchObject({ seq: first.seq, rejected: [] });
      const rejected = await push(runtime, "ws-writer", [command(2, id(800), "Missing issue")]);
      expect(rejected).toMatchObject({ seq: first.seq, rejected: [{ id: 2 }] });

      const branchId = id(801);
      await json(runtime, "/sync/branch/create", { id: branchId, name: "Private socket proposal" });
      const branch = await push(runtime, "ws-private-writer", [command(1, issueId, "Private branch title")], branchId);
      expect(branch.seq).toBeGreaterThan(first.seq);
      // A subsequent main commit is a frame-order barrier: extra retry/rejection/
      // branch notifications would appear before it, without timeout-based silence checks.
      const barrier = await push(runtime, "ws-writer", [command(3, issueId, "Main notification barrier")]);
      await expect
        .poll(() => messages)
        .toEqual([
          { type: "poke", seq: baseline },
          { type: "poke", seq: first.seq },
          { type: "poke", seq: barrier.seq },
        ]);

      await runtime.hibernate();
      expect(connection.socket.readyState).toBe(WebSocket.OPEN);
      const awakened = await push(runtime, "ws-writer", [command(4, issueId, "Committed after hibernation")]);
      await expect
        .poll(() => messages)
        .toEqual([
          { type: "poke", seq: baseline },
          { type: "poke", seq: first.seq },
          { type: "poke", seq: barrier.seq },
          { type: "poke", seq: awakened.seq },
        ]);
    } finally {
      await connection?.close();
      await runtime.close();
    }
  }, 15000);

  it("validates socket admission and rechecks identities across hibernation", async () => {
    const runtime = await startWorkspaceRuntime();
    let connection: Awaited<ReturnType<typeof connect>> | undefined;
    try {
      const { issueId } = await runtime.seed();
      expect((await runtime.fetch("/sync/connect?clientId=plain-http")).status).toBe(426);
      expect((await runtime.fetch("/sync/connect?clientId=wrong-method", { method: "POST" })).status).toBe(405);
      const invalid: { path: string; status: number; headers?: Record<string, string> }[] = [
        { path: "/sync/connect", status: 400 },
        { path: "/sync/connect?clientId=bad&extra=yes", status: 400 },
        { path: "/sync/connect?clientId=bad&__proto__=ignored", status: 400 },
        { path: "/sync/connect?clientId=first&clientId=second", status: 400 },
        { path: `/sync/connect?clientId=bad&branchId=${id(810)}`, status: 400 },
        { path: "/sync/connect?clientId=bad-origin", headers: { Origin: "https://unrelated.example" }, status: 403 },
        { path: "/sync/connect?clientId=bad-actor", headers: { "X-Kanbun-Local-Actor": "unknown" }, status: 401 },
      ];
      for (const { path, status, headers } of invalid) expect(await upgrade(runtime, path, headers), path).toBe(status);

      const bob = await runtime.fetch("/sync/bootstrap?clientId=bob-ws-reader", {
        headers: { "X-Kanbun-Local-Actor": "bob" },
      });
      expect(bob.status).toBe(200);
      expect(await upgrade(runtime, "/sync/connect?clientId=bob-ws-reader", { Origin: runtime.origin })).toBe(403);
      expect(
        await upgrade(runtime, "/sync/connect?clientId=bob-ws-reader&branchId=main", {
          Origin: runtime.origin,
          "X-Kanbun-Local-Actor": "bob",
        }),
      ).toBe(101);

      const branchId = id(811);
      await json(runtime, "/sync/branch/create", { id: branchId, name: "Bound branch identity" });
      await json(runtime, `/sync/bootstrap?clientId=branch-bound&branchId=${branchId}`);
      expect(await upgrade(runtime, "/sync/connect?clientId=branch-bound")).toBe(403);

      connection = await connect(runtime, "ws-client-message");
      await expect.poll(() => connection!.messages.length).toBe(1);
      await runtime.hibernate();
      connection.socket.send(JSON.stringify({ type: "push", mutations: [] }));
      expect((await connection.closed).code).toBe(1008);

      connection = await connect(runtime, "ws-revoked-member");
      await expect.poll(() => connection!.messages.length).toBe(1);
      await runtime.hibernate();
      await runtime.setMemberActive("alice", false);
      const committed = await runtime.fetch("/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Kanbun-Local-Actor": "bob" },
        body: JSON.stringify({
          clientId: "ws-bob-writer",
          mutations: [command(1, issueId, "Active Bob commits after Alice is revoked")],
        }),
      });
      expect(committed.status).toBe(200);
      expect(await committed.json()).toMatchObject({ ok: true, rejected: [] });
      expect((await connection.closed).code).toBe(1008);
      expect(connection.messages).toHaveLength(1);
    } finally {
      await connection?.close();
      await runtime.close();
    }
  }, 15000);

  it("refuses WebSocket upgrades unless local development is explicitly enabled", async () => {
    const runtime = await startWorkspaceRuntime({ localDev: false });
    try {
      expect(await upgrade(runtime, "/sync/connect?clientId=disabled")).toBe(503);
    } finally {
      await runtime.close();
    }
  }, 15000);
});
