import { describe, expect, it } from "vitest";
import { mutators } from "@kanbun/mutators";
import type { Mutation, PushResponse } from "@kanbun/sync";
import { httpTransport, SyncClient } from "@kanbun/sync/client";
import type { BranchMergeReceipt, BranchPreview } from "@kanbun/sync/server";
import { startWorkspaceRuntime } from "./runtime";

type Runtime = Awaited<ReturnType<typeof startWorkspaceRuntime>>;
const ALICE = { id: "user-alice", type: "user" } as const;
const BOB = { id: "user-bob", type: "user" } as const;
const id = (n: number) => `019a0000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const command = (n: number, name: string, args: unknown): Mutation => ({
  id: n,
  name,
  args,
  ts: "2026-10-29T12:00:00.000Z",
});
const create = (issueId: string, teamId: string, subscriptionId: string, title: string) => ({
  id: issueId,
  teamId,
  subscriptionId,
  title,
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

function transport(runtime: Runtime, actor: "alice" | "bob") {
  const fetchImpl: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const headers = new Headers(init?.headers);
    headers.set("X-Kanbun-Local-Actor", actor);
    return runtime.fetch(`${url.pathname}${url.search}`, { ...init, headers });
  };
  return httpTransport(runtime.origin, fetchImpl);
}

describe("workspace Durable Object in workerd", () => {
  it("applies the shipped migrations to a fresh object and seeds it idempotently", async () => {
    const runtime = await startWorkspaceRuntime();
    try {
      const seeded = await runtime.seed();
      const before = await runtime.inspect();
      expect(before.migrations).toHaveLength(5);
      expect(before.issues).toMatchObject([{ id: seeded.issueId, teamId: seeded.teamId, number: 1 }]);
      expect(before.teams).toMatchObject([{ id: seeded.teamId, issue_counter: 1 }]);
      expect(before.events).toContainEqual(
        expect.objectContaining({ type: "IssueCreated", entity_id: seeded.issueId, branch_id: "main" }),
      );
      expect(before.seq).toBeGreaterThan(0);
      expect(await runtime.seed()).toEqual(seeded);
      const after = await runtime.inspect();
      expect(after.migrations).toEqual(before.migrations);
      expect(after.issues).toEqual(before.issues);
      expect(after.events).toEqual(before.events);
      expect(after.log).toEqual(before.log);
      expect(after.seq).toBe(before.seq);
    } finally {
      await runtime.close();
    }
  });

  it("converges two ordinary sync clients through the HTTP transport", async () => {
    const runtime = await startWorkspaceRuntime();
    try {
      const { teamId, issueId } = await runtime.seed();
      const errors: unknown[] = [];
      const alice = new SyncClient({
        actor: ALICE,
        clientId: "http-alice",
        mutators,
        transport: transport(runtime, "alice"),
        pushDelayMs: 0,
        onError: (error) => errors.push(error),
      });
      const bob = new SyncClient({
        actor: BOB,
        clientId: "http-bob",
        mutators,
        transport: transport(runtime, "bob"),
        pushDelayMs: 0,
        onError: (error) => errors.push(error),
      });
      await alice.start();
      await bob.start();
      alice.mutate("issueUpdate", { id: issueId, patch: { title: "Alice's HTTP edit" } });
      bob.mutate("issueUpdate", { id: issueId, patch: { priority: 2 } });
      alice.mutate("issueCreate", create(id(100), teamId, id(101), "Alice's creation"));
      bob.mutate("issueCreate", create(id(102), teamId, id(103), "Bob's creation"));
      await alice.push();
      await bob.push();
      await alice.pull();
      await bob.pull();
      expect(errors).toEqual([]);
      expect(alice.pendingCount()).toBe(0);
      expect(bob.pendingCount()).toBe(0);
      expect(alice.get("issue", issueId)).toMatchObject({ title: "Alice's HTTP edit", priority: 2 });
      const issues = (client: typeof alice) => client.list("issue").sort((a, b) => a.id.localeCompare(b.id));
      expect(issues(alice)).toEqual(issues(bob));
      expect(
        issues(alice)
          .map((issue) => issue.number)
          .sort((a, b) => a - b),
      ).toEqual([1, 2, 3]);
      expect(issues(alice)).toEqual([...(await runtime.inspect()).issues].sort((a, b) => a.id.localeCompare(b.id)));
    } finally {
      await runtime.close();
    }
  });

  it("rolls back a late child collision without losing the accepted mutations around it", async () => {
    const runtime = await startWorkspaceRuntime();
    try {
      const { teamId } = await runtime.seed();
      const clientId = "mixed-http-batch";
      const rejectedIssue = id(202);
      const body = {
        clientId,
        mutations: [
          command(1, "issueCreate", create(id(200), teamId, id(201), "Accepted before")),
          command(2, "issueCreate", create(rejectedIssue, teamId, id(201), "Fails after issue insertion")),
          command(3, "issueCreate", create(id(203), teamId, id(204), "Accepted after")),
        ],
      };
      const response = await json<PushResponse>(runtime, "/sync/push", body);
      expect(response).toMatchObject({ ok: true, lastMutationId: 3, rejected: [{ id: 2 }] });
      if (!response.ok) throw new Error("Mixed push failed as a whole");
      expect(response.rejected).toHaveLength(1);
      expect(response.rejected[0]?.error).toMatch(/subscription|already exists|unique/i);
      const beforeRetry = await runtime.inspect();
      expect(beforeRetry.issues.find((issue) => issue.id === rejectedIssue)).toBeUndefined();
      expect(beforeRetry.issues.find((issue) => issue.id === id(200))?.number).toBe(2);
      expect(beforeRetry.issues.find((issue) => issue.id === id(203))?.number).toBe(3);
      expect(beforeRetry.teams).toMatchObject([{ id: teamId, issue_counter: 3 }]);
      expect(beforeRetry.clients).toContainEqual(expect.objectContaining({ client_id: clientId, last_mutation_id: 3 }));
      expect(beforeRetry.events.filter((event) => event.client_id === clientId)).toHaveLength(2);
      expect(beforeRetry.events.some((event) => event.entity_id === rejectedIssue)).toBe(false);
      expect(beforeRetry.log.some((entry) => entry.client_id === clientId && entry.mutation_id === 2)).toBe(false);
      expect(await json<PushResponse>(runtime, "/sync/push", body)).toMatchObject({
        ok: true,
        lastMutationId: 3,
        rejected: [],
      });
      const afterRetry = await runtime.inspect();
      expect(afterRetry.issues).toEqual(beforeRetry.issues);
      expect(afterRetry.events).toEqual(beforeRetry.events);
      expect(afterRetry.log).toEqual(beforeRetry.log);
      expect(afterRetry.seq).toBe(beforeRetry.seq);
    } finally {
      await runtime.close();
    }
  });

  it("persists branch merges and exact retry receipts across Durable Object eviction", async () => {
    const runtime = await startWorkspaceRuntime();
    try {
      const { teamId, issueId } = await runtime.seed();
      const branchId = id(300);
      await json(runtime, "/sync/branch/create", { id: branchId, name: "HTTP proposal", scope: { teamIds: [teamId] } });
      expect(
        await json<PushResponse>(runtime, "/sync/push", {
          clientId: "http-proposal",
          branchId,
          mutations: [
            command(1, "issueCreate", create(id(301), teamId, id(302), "Proposed creation")),
            command(2, "issueUpdate", { id: issueId, patch: { title: "Reviewed over HTTP" } }),
          ],
        }),
      ).toMatchObject({ ok: true, lastMutationId: 2, rejected: [] });
      const unmerged = await runtime.inspect();
      expect(unmerged.issues.find((issue) => issue.id === id(301))).toBeUndefined();
      expect(unmerged.overlays.length).toBeGreaterThan(0);
      for (const path of [
        `/sync/branch/get?branchId=${branchId}`,
        `/sync/bootstrap?clientId=bob-private-reader&branchId=${branchId}`,
      ]) {
        const denied = await runtime.fetch(path, { headers: { "X-Kanbun-Local-Actor": "bob" } });
        expect([403, 404]).toContain(denied.status);
      }
      const preview = await json<BranchPreview>(runtime, `/sync/branch/preview?branchId=${branchId}`);
      expect(preview.conflicts).toEqual([]);
      const input = {
        branchId,
        mergeId: id(303),
        expectedBranchHeadSeq: preview.branchHeadSeq,
        expectedMainSyncSeq: preview.mainSyncSeq,
      };
      const receipt = await json<BranchMergeReceipt>(runtime, "/sync/branch/merge", input);
      expect(receipt).toMatchObject({ ok: true, branchId, mergeId: input.mergeId, appliedEvents: 2 });
      const merged = await runtime.inspect();
      expect(merged.issues.find((issue) => issue.id === id(301))).toMatchObject({ number: 2 });
      expect(merged.issues.find((issue) => issue.id === issueId)?.title).toBe("Reviewed over HTTP");
      expect(merged.overlays).toEqual([]);
      expect(merged.branches).toContainEqual(expect.objectContaining({ id: branchId, status: "merged" }));
      expect(merged.events.filter((event) => event.type === "BranchMerged")).toHaveLength(1);
      await runtime.restart();
      expect(await json<BranchMergeReceipt>(runtime, "/sync/branch/merge", structuredClone(input))).toEqual(receipt);
      expect(await json<BranchMergeReceipt>(runtime, "/sync/branch/merge", structuredClone(input))).toEqual(receipt);
      const restored = await runtime.inspect();
      expect(restored.migrations).toEqual(merged.migrations);
      expect(restored.issues).toEqual(merged.issues);
      expect(restored.events).toEqual(merged.events);
      expect(restored.log).toEqual(merged.log);
      expect(restored.seq).toBe(merged.seq);
      expect(restored.teams).toMatchObject([{ id: teamId, issue_counter: 2 }]);
      expect(await json(runtime, `/sync/branch/get?branchId=${branchId}`)).toMatchObject({ status: "merged" });
      const closed = await runtime.fetch(`/sync/pull?clientId=http-proposal&branchId=${branchId}&since=0`);
      expect(closed.status).toBe(403);
      expect(await closed.json()).toMatchObject({ code: "forbidden", error: expect.stringMatching(/not open/i) });
    } finally {
      await runtime.close();
    }
  });

  it("rejects invalid HTTP envelopes without changing workspace data", async () => {
    const runtime = await startWorkspaceRuntime();
    try {
      await runtime.seed();
      const before = await runtime.inspect();
      const invalid: { path: string; init?: RequestInit; status: number }[] = [
        { path: "/sync/bootstrap?clientId=invalid", init: { method: "POST" }, status: 405 },
        { path: "/sync/push", status: 405 },
        { path: "/sync/load?model=unknown&parentId=parent", status: 400 },
        { path: "/sync/pull?clientId=invalid&since=-1", status: 400 },
        { path: "/sync/pull?clientId=invalid&since=NaN", status: 400 },
        { path: "/sync/bootstrap?clientId=first&clientId=second", status: 400 },
        { path: "/sync/bootstrap?clientId=invalid&unexpected=yes", status: 400 },
        {
          path: "/sync/bootstrap?clientId=invalid",
          init: { headers: { "X-Kanbun-Local-Actor": "unknown" } },
          status: 401,
        },
        {
          path: "/sync/push",
          init: { method: "POST", headers: { "content-type": "application/json" }, body: "{" },
          status: 400,
        },
        {
          path: "/sync/push",
          init: {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ clientId: "invalid", mutations: "wrong" }),
          },
          status: 400,
        },
      ];
      for (const { path, init, status } of invalid) {
        const response = await runtime.fetch(path, init);
        expect(response.status, path).toBe(status);
      }
      const after = await runtime.inspect();
      expect(after.issues).toEqual(before.issues);
      expect(after.events).toEqual(before.events);
      expect(after.log).toEqual(before.log);
      expect(after.branches).toEqual(before.branches);
      expect(after.seq).toBe(before.seq);
    } finally {
      await runtime.close();
    }
  });

  it("keeps sync and seed routes unavailable without the explicit local development flag", async () => {
    const runtime = await startWorkspaceRuntime({ localDev: false });
    try {
      for (const [path, init] of [
        ["/sync/bootstrap?clientId=disabled", undefined],
        ["/sync/push", { method: "POST", body: "{}" }],
        ["/__local/seed", { method: "POST", body: "{}" }],
      ] as const) {
        expect((await runtime.fetch(path, init)).status).toBe(503);
      }
    } finally {
      await runtime.close();
    }
  });
});
