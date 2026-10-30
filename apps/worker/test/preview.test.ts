import { describe, expect, it } from "vitest";
import type { PushResponse } from "@kanbun/sync";
import { startPreviewRuntime, startWorkspaceRuntime } from "./runtime";

const id = (n: number) => `019a0000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const creation = (teamId: string, mutationId = 1) => ({
  clientId: "preview-mutations",
  mutations: [
    {
      id: mutationId,
      name: "issueCreate",
      ts: "2026-10-30T12:00:00.000Z",
      args: { id: id(9200), teamId, title: "Private owner mutation", subscriptionId: id(9201) },
    },
  ],
});
const post = (value: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});

describe("protected owner preview in workerd", () => {
  it("describes an unseeded local workspace and fails closed for conflicting modes", async () => {
    const local = await startWorkspaceRuntime();
    try {
      expect(await (await local.fetch("/api/context")).json()).toEqual({
        mode: "local",
        workspaceId: "local",
        workspaceName: "Local workspace",
        actor: { id: "user-alice", type: "user" },
        name: "Alice",
        email: "alice@example.com",
      });
      expect((await local.fetch("/sync/bootstrap?clientId=unseeded")).status).toBe(403);
    } finally {
      await local.close();
    }
    const conflicting = await startPreviewRuntime({ localDev: true });
    try {
      for (const path of ["/api/context", "/sync/bootstrap?clientId=conflicting", "/__local/seed"])
        expect((await conflicting.fetch(path, path === "/__local/seed" ? post({}) : {})).status).toBe(503);
      expect(await conflicting.directoryCounts()).toEqual({ accounts: 0, workspaces: 0, members: 0 });
    } finally {
      await conflicting.close();
    }
  }, 30000);

  it("verifies the real owner, initializes once under concurrent access, and survives restart", async () => {
    const runtime = await startPreviewRuntime();
    try {
      expect((await runtime.fetch("/", {}, null)).status).toBe(401);
      const asset = await runtime.fetch("/");
      expect(asset.status).toBe(200);
      expect(await asset.text()).toBe("Protected preview asset");
      expect(await runtime.directoryCounts()).toEqual({ accounts: 0, workspaces: 0, members: 0 });
      const contexts = await Promise.all(Array.from({ length: 5 }, () => runtime.context()));
      const context = contexts[0]!;
      expect(context).toMatchObject({
        mode: "hosted",
        workspaceId: runtime.workspaceId,
        workspaceName: "Private preview",
        name: "Preview owner",
        email: "owner@example.com",
        actor: { type: "user" },
      });
      for (const other of contexts) expect(other).toEqual(context);
      expect(context.actor.id).not.toMatch(/^user-(alice|bob)$/);
      expect(await runtime.directoryCounts()).toEqual({ accounts: 1, workspaces: 1, members: 1 });
      const initial = await runtime.inspect();
      expect(initial.rows.user).toMatchObject([{ id: context.actor.id, active: true, role: "owner" }]);
      expect(initial.rows.user).toHaveLength(1);
      expect(initial.rows.team).toMatchObject([{ key: "KAN", issueCounter: 0 }]);
      expect(initial.rows.issue ?? []).toEqual([]);
      expect(initial.directory.identities).toMatchObject([
        { provider: "cloudflare-access", account_id: context.actor.id },
      ]);
      const response = await runtime.fetch("/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Kanbun-Local-Actor": "bob", "X-Kanbun-Principal": "forged" },
        body: JSON.stringify({
          clientId: "preview-owner-writes",
          mutations: [
            {
              id: 1,
              name: "issueCreate",
              ts: "2026-10-30T12:00:00.000Z",
              args: {
                id: id(9100),
                teamId: initial.rows.team![0]!["id"],
                title: "Owner's private issue",
                subscriptionId: id(9101),
                creatorId: "user-bob",
              },
            },
          ],
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, rejected: [] });
      const before = await runtime.inspect();
      expect(before.rows.issue).toMatchObject([
        { id: id(9100), title: "Owner's private issue", creatorId: context.actor.id, number: 1 },
      ]);
      await runtime.restart();
      expect(await runtime.context()).toEqual(context);
      const after = await runtime.inspect();
      expect(after.rows.issue).toEqual(before.rows.issue);
      expect(after.directory).toEqual(before.directory);
      expect(await runtime.certificateRequests()).toEqual({ requests: 1 });
    } finally {
      await runtime.close();
    }
  }, 30000);

  it("rejects invalid tokens, foreign identities, forged actor headers and cross-origin writes", async () => {
    const runtime = await startPreviewRuntime();
    try {
      const identity = await runtime.context();
      const valid = await runtime.token();
      const signatureStart = valid.lastIndexOf(".") + 1;
      const tampered =
        valid.slice(0, signatureStart) + (valid[signatureStart] === "A" ? "B" : "A") + valid.slice(signatureStart + 1);
      const denied: { assertion: string | null; status: number }[] = [
        { assertion: null, status: 401 },
        { assertion: "not-a-jwt", status: 401 },
        { assertion: tampered, status: 401 },
        { assertion: await runtime.token({ iss: "https://another.cloudflareaccess.com" }), status: 401 },
        { assertion: await runtime.token({ aud: "another-application" }), status: 401 },
        { assertion: await runtime.token({ exp: Math.floor(Date.now() / 1000) - 1 }), status: 401 },
        { assertion: await runtime.token({ nbf: Math.floor(Date.now() / 1000) + 3600 }), status: 401 },
        { assertion: await runtime.token({ exp: undefined }), status: 401 },
        { assertion: await runtime.token({ sub: undefined }), status: 401 },
        { assertion: await runtime.token({ email: "someone-else@example.com" }), status: 403 },
        { assertion: await runtime.token({ sub: "another-subject-with-the-same-email" }), status: 403 },
      ];
      for (const { assertion, status } of denied) {
        const response = await runtime.fetch(
          "/api/context",
          {
            headers: {
              "Cf-Access-Authenticated-User-Email": runtime.ownerEmail,
              "X-Kanbun-Local-Actor": "alice",
              "X-Kanbun-Principal": encodeURIComponent(
                JSON.stringify({ actor: identity.actor, expiresAt: Date.now() + 3600000 }),
              ),
            },
          },
          assertion,
        );
        expect(response.status, assertion === null ? "missing signed JWT" : `token expecting ${status}`).toBe(status);
      }
      const initial = await runtime.inspect();
      const write = creation(String(initial.rows.team![0]!["id"]));
      const badOrigin = post(write);
      badOrigin.headers = { "content-type": "application/json", Origin: "https://unrelated.example" };
      expect((await runtime.fetch("/sync/push", badOrigin)).status).toBe(403);
      const missingOrigin = post(write);
      missingOrigin.headers = { "content-type": "application/json", "Cf-Access-Jwt-Assertion": valid };
      expect((await fetch(new URL("/sync/push", runtime.origin), missingOrigin)).status).toBe(403);
      await expect(runtime.connect("bad-origin-socket", undefined, "https://unrelated.example")).rejects.toThrow("403");
      await expect(runtime.connect("missing-origin-socket", undefined, null)).rejects.toThrow("403");
      expect(
        (await runtime.fetch("/sync/push", post({ ...write, actor: { id: "user-bob", type: "user" } }))).status,
      ).toBe(400);
      expect((await runtime.fetch("/__local/seed", post({}))).status).toBe(404);
      expect(await runtime.directoryCounts()).toEqual({ accounts: 1, workspaces: 1, members: 1 });
      const after = await runtime.inspect();
      expect(after.rows.issue ?? []).toEqual([]);
      expect(after.events).toEqual(initial.events);
      expect(await runtime.context()).toEqual(identity);
    } finally {
      await runtime.close();
    }
  }, 30000);

  it("honors inactive, archived, downgraded and revoked memberships instead of restoring access", async () => {
    const runtime = await startPreviewRuntime();
    let socket: Awaited<ReturnType<typeof runtime.connect>> | undefined;
    try {
      await runtime.context();
      const initial = await runtime.inspect();
      const write = creation(String(initial.rows.team![0]!["id"]));
      for (const state of ["inactive", "archived", "downgraded"] as const) {
        await runtime.setOwnerState(state);
        expect((await runtime.fetch("/api/context")).status, state).toBe(403);
        expect((await runtime.fetch("/sync/push", post(write))).status, state).toBe(403);
        await runtime.setOwnerState("active");
        expect((await runtime.fetch("/api/context")).status).toBe(200);
      }
      expect((await runtime.inspect()).rows.issue ?? []).toEqual([]);
      socket = await runtime.connect("directory-revocation-socket");
      await expect.poll(() => socket!.messages.length).toBe(1);
      await runtime.hibernate();
      await runtime.revokeMember();
      expect((await runtime.fetch("/api/context")).status).toBe(403);
      expect((await runtime.fetch("/sync/push", post(write))).status).toBe(403);
      await runtime.wake();
      expect((await socket.closed).code).toBe(1008);
      expect(socket.messages).toHaveLength(1);
      expect(await runtime.directoryCounts()).toEqual({ accounts: 1, workspaces: 1, members: 1 });
    } finally {
      socket?.close();
      await runtime.close();
    }
  }, 30000);

  it("expires a hibernated socket before the next commit hint while fresh authentication remains usable", async () => {
    const runtime = await startPreviewRuntime();
    let expired: Awaited<ReturnType<typeof runtime.connect>> | undefined;
    let fresh: Awaited<ReturnType<typeof runtime.connect>> | undefined;
    try {
      const context = await runtime.context();
      const initial = await runtime.inspect();
      const expiration = Math.floor(Date.now() / 1000) + 2;
      const shortToken = await runtime.token({ exp: expiration });
      expired = await runtime.connect("short-lived-socket", shortToken);
      await expect.poll(() => expired!.messages).toEqual([{ type: "poke", seq: initial.seq }]);
      await runtime.hibernate();
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, expiration * 1000 - Date.now() + 30)));
      expect((await runtime.fetch("/api/context", {}, shortToken)).status).toBe(401);
      const committed = await runtime.fetch("/sync/push", post(creation(String(initial.rows.team![0]!["id"]))));
      expect(committed.status).toBe(200);
      const result = (await committed.json()) as PushResponse;
      expect(result).toMatchObject({ ok: true, rejected: [] });
      expect((await expired.closed).code).toBe(1008);
      expect(expired.messages).toHaveLength(1);
      expect(await runtime.context()).toEqual(context);
      fresh = await runtime.connect("fresh-owner-socket");
      const current = await runtime.inspect();
      await expect.poll(() => fresh!.messages).toEqual([{ type: "poke", seq: current.seq }]);
      await runtime.hibernate();
      const renamed = await runtime.fetch(
        "/sync/push",
        post({
          clientId: "fresh-owner-rename",
          mutations: [
            {
              id: 1,
              name: "issueUpdate",
              ts: "2026-10-30T12:00:00.000Z",
              args: { id: id(9200), patch: { title: "Fresh owner can still edit" } },
            },
          ],
        }),
      );
      const renameResult = (await renamed.json()) as PushResponse;
      expect(renameResult).toMatchObject({ ok: true, rejected: [] });
      if (!renameResult.ok) throw new Error("Fresh owner mutation failed");
      await expect
        .poll(() => fresh!.messages)
        .toEqual([
          { type: "poke", seq: current.seq },
          { type: "poke", seq: renameResult.seq },
        ]);
    } finally {
      expired?.close();
      fresh?.close();
      await runtime.close();
    }
  }, 30000);
});
