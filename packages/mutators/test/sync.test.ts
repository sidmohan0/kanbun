/**
 * Phase-0 gates, run against the real mutators and the real server over node:sqlite:
 *  - two clients converge after offline edits on both sides
 *  - an agent creates 500 issues concurrently with retries; the log is consistent and idempotent
 * plus the rules the review added: Zod validation on push, provenance on the log, private-team filtering, proposals.
 */
import { describe, expect, it } from "vitest";
import { uuidv7 } from "@kanbun/model";
import type { Actor, Transport } from "@kanbun/sync";
import { MemoryPersister, SyncClient } from "@kanbun/sync/client";
import { SyncServer, SYSTEM_ACTOR } from "@kanbun/sync/server";
import { openWorkspaceDb } from "@kanbun/sync/server/node";
import { mutators, tools } from "../src";

type Net = { online: boolean };

function transportFor(server: SyncServer, actor: Actor, net: Net): Transport {
  const guard = async <T>(fn: () => T): Promise<T> => {
    if (!net.online) throw new Error("offline");
    await Promise.resolve();
    return fn();
  };
  return {
    bootstrap: (clientId) => guard(() => structuredClone(server.bootstrap(actor, clientId))),
    push: (req) => guard(() => structuredClone(server.push(actor, structuredClone(req)))),
    pull: (req) => guard(() => structuredClone(server.pull(actor, req))),
    load: (req) => guard(() => structuredClone(server.load(actor, req))),
  };
}

const ALICE: Actor = { id: "user-alice", type: "user" };
const BOB: Actor = { id: "user-bob", type: "user" };
const ts = () => new Date().toISOString();

async function setup() {
  const { driver } = openWorkspaceDb();
  const server = new SyncServer({ driver, mutators });
  server.system("workspaceInit", {
    organization: { id: uuidv7(), name: "DataFog", urlKey: "datafog" },
    owner: { id: ALICE.id, name: "Alice A", email: "alice@example.com" },
  });
  server.system("memberSync", { id: BOB.id, name: "Bob B", email: "bob@example.com" });
  const teamId = uuidv7();
  const stateIds = { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() };
  const t = server.push(ALICE, {
    clientId: "alice-seed",
    mutations: [
      {
        id: 1,
        name: "teamCreate",
        args: { id: teamId, name: "DataFog", key: "DF", stateIds, membershipId: uuidv7() },
        ts: ts(),
      },
      { id: 2, name: "teamMembershipCreate", args: { id: uuidv7(), teamId, userId: BOB.id }, ts: ts() },
    ],
  });
  expect(t.ok && t.rejected).toEqual([]);

  const clients: SyncClient<typeof mutators>[] = [];
  server.onCommit(() => {
    for (const c of clients) c.pull().catch(() => {}); // reported through onError; a poke is fire-and-forget
  });
  const mk = (actor: Actor, net: Net) => {
    const c = new SyncClient({
      transport: transportFor(server, actor, net),
      mutators,
      actor,
      persister: new MemoryPersister(),
      pushDelayMs: 0,
    });
    clients.push(c);
    return c;
  };
  const netA: Net = { online: true };
  const netB: Net = { online: true };
  const a = mk(ALICE, netA);
  const b = mk(BOB, netB);
  await a.start();
  await b.start();
  return { server, a, b, netA, netB, teamId, stateIds, mk };
}

const settle = async (...clients: SyncClient<typeof mutators>[]) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 5));
    for (const c of clients) {
      await c.push();
      await c.pull();
    }
  }
};

const snapshot = (c: SyncClient<typeof mutators>, model: "issue" | "issueLabelLink" | "comment") =>
  c
    .list(model)
    .map((r) => JSON.stringify(r))
    .sort();

describe("sync engine", () => {
  it("bootstraps both clients with the same state", async () => {
    const { a, b } = await setup();
    expect(a.list("team")).toHaveLength(1);
    expect(b.list("team")).toEqual(a.list("team"));
    expect(a.list("workflowState")).toHaveLength(5);
    expect(
      a
        .list("user")
        .map((u) => u.email)
        .sort(),
    ).toEqual(["alice@example.com", "bob@example.com"]);
  });

  it("assigns numbers only on the server, and the client catches up", async () => {
    const { a, b, teamId } = await setup();
    const id = uuidv7();
    a.mutate("issueCreate", { id, teamId, title: "First issue", subscriptionId: uuidv7() });
    expect(a.get("issue", id)?.number).toBe(0);
    await settle(a, b);
    expect(a.get("issue", id)?.number).toBe(1);
    expect(b.get("issue", id)?.number).toBe(1);
    expect(a.pendingCount()).toBe(0);
  });

  it("converges after offline edits on both sides", async () => {
    const { a, b, netA, netB, teamId, stateIds } = await setup();
    const shared = uuidv7();
    a.mutate("issueCreate", { id: shared, teamId, title: "Shared", subscriptionId: uuidv7() });
    await settle(a, b);
    expect(b.get("issue", shared)?.number).toBe(1);

    netA.online = false;
    netB.online = false;

    a.mutate("issueUpdate", { id: shared, patch: { title: "Shared (alice)" } });
    const a1 = uuidv7();
    const a2 = uuidv7();
    a.mutate("issueCreate", { id: a1, teamId, title: "Alice 1", subscriptionId: uuidv7() });
    a.mutate("issueCreate", { id: a2, teamId, title: "Alice 2", subscriptionId: uuidv7() });
    a.mutate("issueUpdate", { id: shared, patch: { stateId: stateIds.inProgress } });

    b.mutate("issueUpdate", { id: shared, patch: { priority: 1 } });
    const b1 = uuidv7();
    b.mutate("issueCreate", { id: b1, teamId, title: "Bob 1", subscriptionId: uuidv7() });
    b.mutate("commentCreate", { id: uuidv7(), issueId: shared, body: "hello from bob", subscriptionId: uuidv7() });
    b.mutate("issueUpdate", { id: shared, patch: { assigneeId: BOB.id }, assigneeSubscriptionId: uuidv7() });

    expect(a.get("issue", shared)?.title).toBe("Shared (alice)");
    expect(a.get("issue", shared)?.priority).toBe(0);
    expect(b.get("issue", shared)?.title).toBe("Shared");
    expect(b.get("issue", shared)?.priority).toBe(1);
    expect(a.pendingCount()).toBe(4);
    expect(b.pendingCount()).toBe(4);

    await a.push();
    await expect(a.pull()).rejects.toThrow("offline");
    await b.push();
    expect(a.getStatus()).toBe("offline");
    expect(a.pendingCount()).toBe(4);

    netB.online = true;
    await settle(b);
    netA.online = true;
    await settle(a, b);

    const s = a.get("issue", shared)!;
    expect(s.title).toBe("Shared (alice)");
    expect(s.priority).toBe(1);
    expect(s.assigneeId).toBe(BOB.id);
    expect(s.stateId).toBe(stateIds.inProgress);
    expect(s.startedAt).not.toBeNull();
    expect(b.get("issue", shared)).toEqual(s);
    expect(snapshot(a, "issue")).toEqual(snapshot(b, "issue"));
    expect(a.pendingCount()).toBe(0);
    expect(b.pendingCount()).toBe(0);

    const numbers = a
      .list("issue")
      .map((i) => i.number)
      .sort((x, y) => x - y);
    expect(numbers).toEqual([1, 2, 3, 4]);

    // Comments are on-demand: not in the bootstrap, but new ones stream in via the log,
    // and isLoaded says whether the client has the complete set for an issue.
    expect(a.isLoaded("comment", shared)).toBe(false);
    await a.load("comment", shared);
    expect(a.isLoaded("comment", shared)).toBe(true);
    expect(a.list("comment", { issueId: shared })).toHaveLength(1);
  });

  it("validates args with the mutator's Zod schema on both sides", async () => {
    const { server, a, b, teamId } = await setup();
    const id = uuidv7();
    a.mutate("issueCreate", { id, teamId, title: "ok", subscriptionId: uuidv7() });
    await settle(a, b);
    // Client: the schema rejects before anything is applied.
    expect(() => a.mutate("issueUpdate", { id, patch: { priority: 9 as never } })).toThrow(/priority/);
    expect(a.get("issue", id)?.priority).toBe(0);
    expect(a.pendingCount()).toBe(0);
    // Server: a raw push with bad args is rejected per-mutation, nothing partial is written.
    const res = server.push(ALICE, {
      clientId: "raw",
      mutations: [{ id: 1, name: "issueUpdate", args: { id, patch: { priority: 9 } }, ts: ts() }],
    });
    expect(res.ok && res.rejected[0]?.error).toMatch(/priority/);
    expect(server.store.get("issue", id)?.priority).toBe(0);
    // A retry of the same mutation id is a no-op.
    const again = server.push(ALICE, {
      clientId: "raw",
      mutations: [{ id: 1, name: "issueUpdate", args: { id, patch: { priority: 1 } }, ts: ts() }],
    });
    expect(again.ok && again.rejected).toEqual([]);
    expect(server.store.get("issue", id)?.priority).toBe(0);
  });

  it("rolls back a mutation the server rejects for a rule the client could not check", async () => {
    const { a, b, teamId, server } = await setup();
    const id = uuidv7();
    a.mutate("issueCreate", { id, teamId, title: "ok", subscriptionId: uuidv7() });
    await settle(a, b);
    // Bob's client thinks he can assign to a user Alice's client has since deactivated.
    const rejected: string[] = [];
    const c = new SyncClient({
      transport: b["opts"].transport,
      mutators,
      actor: BOB,
      pushDelayMs: 0,
      onRejected: (_m, e) => rejected.push(e),
    });
    await c.start();
    server.system("memberSync", { id: "user-carol", name: "Carol", email: "carol@example.com" });
    // c has not pulled Carol yet, so the optimistic run fails locally... make it succeed by pulling first.
    await c.pull();
    c.mutate("issueUpdate", { id, patch: { assigneeId: "user-carol" } });
    expect(c.get("issue", id)?.assigneeId).toBe("user-carol");
    // Meanwhile the server deletes Carol's mirror row (simulating removal from the workspace).
    server.store.delete("user", "user-carol");
    await settle(c);
    expect(rejected.join()).toMatch(/assignee not found/);
    expect(c.get("issue", id)?.assigneeId).toBeNull();
    expect(c.pendingCount()).toBe(0);
  });

  it("filters private teams by membership and re-bootstraps when membership changes", async () => {
    const { server, a, b } = await setup();
    const privateTeam = uuidv7();
    const stateIds = { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() };
    a.mutate("teamCreate", {
      id: privateTeam,
      name: "Secret",
      key: "SEC",
      visibility: "private",
      stateIds,
      membershipId: uuidv7(),
    });
    const secretIssue = uuidv7();
    a.mutate("issueCreate", { id: secretIssue, teamId: privateTeam, title: "hush", subscriptionId: uuidv7() });
    await settle(a, b);
    expect(a.get("team", privateTeam)).toBeDefined();
    expect(b.get("team", privateTeam)).toBeUndefined();
    expect(b.get("issue", secretIssue)).toBeUndefined();

    a.mutate("teamMembershipCreate", { id: uuidv7(), teamId: privateTeam, userId: BOB.id });
    await settle(a, b);
    expect(b.get("team", privateTeam)?.name).toBe("Secret");
    expect(b.get("issue", secretIssue)?.title).toBe("hush");
    expect(server.visibleTeamIds(BOB)).toHaveLength(2);
  });

  it("persists and restores without re-bootstrapping", async () => {
    const { server, teamId } = await setup();
    const persister = new MemoryPersister();
    const transport = transportFor(server, ALICE, { online: true });
    const a = new SyncClient({ transport, mutators, actor: ALICE, persister, pushDelayMs: 0 });
    await a.start();
    const id = uuidv7();
    a.mutate("issueCreate", { id, teamId, title: "persist me", subscriptionId: uuidv7() });
    await settle(a);
    const saved = await persister.load();
    expect(saved?.rows.issue?.length).toBe(1);
    const again = new SyncClient({
      transport: {
        ...transport,
        bootstrap: async () => {
          throw new Error("A saved client must restore and pull instead of bootstrapping again.");
        },
      },
      mutators,
      actor: ALICE,
      persister,
      clientId: a.clientId,
    });
    await again.start();
    expect(again.get("issue", id)?.title).toBe("persist me");
    expect(again.getSeq()).toBe(a.getSeq());
  });
});

describe("provenance", () => {
  it("records actor, txn, prev values and reason on every log row", async () => {
    const { server, a, b, teamId, stateIds } = await setup();
    const id = uuidv7();
    a.mutate("issueCreate", { id, teamId, title: "Trace me", subscriptionId: uuidv7() });
    await settle(a, b);
    b.mutate("issueUpdate", { id, patch: { stateId: stateIds.done, priority: 2 } }, { reason: "closing stale issue" });
    await settle(a, b);
    const feed = server.activity(ALICE, { model: "issue", rowId: id });
    expect(feed[0]?.actorId).toBe(BOB.id);
    expect(feed[0]?.actorType).toBe("user");
    expect(feed[0]?.reason).toBe("closing stale issue");
    expect(feed[0]?.patch?.["stateId"]).toBe(stateIds.done);
    expect(feed[0]?.prev?.["stateId"]).toBe(stateIds.backlog);
    const changes = feed.filter((entry) => entry.txnId === feed[0]?.txnId);
    expect(changes.find((entry) => entry.patch?.["priority"] === 2)?.prev?.["priority"]).toBe(0);
    expect(changes.every((entry) => entry.actorId === BOB.id && entry.reason === "closing stale issue")).toBe(true);
    // The create wrote the issue + a subscription in one txn.
    const create = feed.at(-1)!;
    const txn = server.activity(ALICE, { txnId: create.txnId });
    expect(txn.map((e) => e.model).sort()).toEqual(["issue", "issueSubscription", "team"]);
    expect(create.prev).toBeNull();
  });
});

describe("agents", () => {
  const agentSetup = async (mode: "propose" | "commit" = "commit") => {
    const s = await setup();
    const agentId = uuidv7();
    s.a.mutate("agentCreate", { id: agentId, name: "triage-bot", mode, rateBudget: 10_000 });
    await settle(s.a, s.b);
    const AGENT: Actor = { id: agentId, type: "agent" };
    return { ...s, AGENT, agentId };
  };

  it("exposes mutators as JSON-schema tools, minus system-only ones", () => {
    const t = tools();
    const names = t.map((x) => x.name);
    expect(names).toContain("issueCreate");
    expect(names).not.toContain("workspaceInit");
    expect(names).not.toContain("memberSync");
    const create = t.find((x) => x.name === "issueCreate")!;
    expect(create.input_schema["type"]).toBe("object");
    expect((create.input_schema["required"] as string[]).sort()).toEqual(["id", "subscriptionId", "teamId", "title"]);
    expect(tools(["issueUpdate"]).map((x) => x.name)).toEqual(["issueUpdate"]);
  });

  it("gate: 500 concurrent agent creates with retries are consistent and idempotent", async () => {
    const { server, a, teamId, AGENT } = await agentSetup("commit");
    const clientId = "agent-run-1";
    const flaky = { drop: 0 };
    const net: Net = { online: true };
    const base = transportFor(server, AGENT, net);
    // Every third push "times out" after the server applied it, so the client retries the same ids.
    const transport: Transport = {
      ...base,
      push: async (req) => {
        const res = await base.push(req);
        if (++flaky.drop % 3 === 0) throw new Error("timeout after apply");
        return res;
      },
    };
    const agent = new SyncClient({ transport, mutators, actor: AGENT, clientId, pushDelayMs: 0 });
    await agent.start();
    const ids: string[] = [];
    await Promise.all(
      Array.from({ length: 500 }, async (_, i) => {
        const id = uuidv7();
        ids.push(id);
        agent.mutate(
          "issueCreate",
          { id, teamId, title: `bulk ${i}`, subscriptionId: uuidv7() },
          { reason: "bulk import" },
        );
        await agent.push();
      }),
    );
    for (let i = 0; i < 20 && agent.pendingCount() > 0; i++) {
      await agent.push();
      await agent.pull();
    }
    expect(agent.pendingCount()).toBe(0);
    await settle(a);
    const issues = server.store.list("issue", { teamId });
    expect(issues).toHaveLength(500);
    const numbers = issues.map((i) => i.number).sort((x, y) => x - y);
    expect(numbers[0]).toBe(1);
    expect(numbers.at(-1)).toBe(500);
    expect(new Set(numbers).size).toBe(500);
    const agentWrites = server.activity(ALICE, { actorType: "agent", limit: 500 });
    expect(agentWrites.length).toBeGreaterThan(0);
    expect(agentWrites.every((e) => e.actorId === AGENT.id && e.reason === "bulk import")).toBe(true);
    expect(a.list("issue")).toHaveLength(500);
  });

  it("enforces propose mode, mutator scopes and team scopes", async () => {
    const { server, a, b, teamId, AGENT, agentId } = await agentSetup("propose");
    const push = (name: string, args: unknown, mid = 1) =>
      server.push(AGENT, { clientId: `agent-${mid}`, mutations: [{ id: 1, name, args, ts: ts() }] });
    expect(push("issueCreate", { id: uuidv7(), teamId, title: "x", subscriptionId: uuidv7() }).ok).toBe(false);

    a.mutate("agentUpdate", {
      id: agentId,
      patch: { mode: "commit", scopes: { teamIds: [], projectIds: [], mutators: ["commentCreate"] } },
    });
    await settle(a, b);
    const r = push("issueCreate", { id: uuidv7(), teamId, title: "x", subscriptionId: uuidv7() }, 2);
    expect(r.ok && r.rejected[0]?.error).toMatch(/not allowed/);

    const other = uuidv7();
    a.mutate("teamCreate", {
      id: other,
      name: "Other",
      key: "OT",
      stateIds: { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() },
      membershipId: uuidv7(),
    });
    a.mutate("agentUpdate", { id: agentId, patch: { scopes: { teamIds: [other], projectIds: [], mutators: [] } } });
    await settle(a, b);
    const r2 = push("issueCreate", { id: uuidv7(), teamId, title: "x", subscriptionId: uuidv7() }, 3);
    expect(r2.ok && r2.rejected[0]?.error).toMatch(/not scoped/);
    const r3 = push("issueCreate", { id: uuidv7(), teamId: other, title: "ok", subscriptionId: uuidv7() }, 4);
    expect(r3.ok && r3.rejected).toEqual([]);
  });

  it("proposals: a named layer renders optimistically, can be discarded, or accepted into the push queue", async () => {
    const { a, b, teamId, stateIds } = await setup();
    const id = uuidv7();
    a.mutate("issueCreate", { id, teamId, title: "Needs triage", subscriptionId: uuidv7() });
    await settle(a, b);

    a.addLayer("proposal:bot-1", { id: "agent-x", type: "agent" });
    a.mutateIn(
      "proposal:bot-1",
      "issueUpdate",
      { id, patch: { priority: 2, stateId: stateIds.todo } },
      { reason: "looks like a P2" },
    );
    expect(a.get("issue", id)?.priority).toBe(2);
    expect(a.viewAt("pending").get("issue", id)?.priority).toBe(0);
    expect(a.pendingCount()).toBe(0);
    expect(a.layerMutations("proposal:bot-1")).toHaveLength(1);

    // Server state moves underneath; the proposal is rebased on top of it.
    b.mutate("issueUpdate", { id, patch: { title: "Needs triage (renamed)" } });
    await settle(a, b);
    expect(a.get("issue", id)?.title).toBe("Needs triage (renamed)");
    expect(a.get("issue", id)?.priority).toBe(2);

    a.removeLayer("proposal:bot-1");
    expect(a.get("issue", id)?.priority).toBe(0);

    a.addLayer("proposal:bot-2");
    a.mutateIn("proposal:bot-2", "issueUpdate", { id, patch: { priority: 3 } });
    a.acceptLayer("proposal:bot-2");
    expect(a.layerNames()).toEqual(["pending"]);
    expect(a.pendingCount()).toBe(1);
    await settle(a, b);
    expect(b.get("issue", id)?.priority).toBe(3);
  });
});

describe("mutator rules", () => {
  it("enforces single-select label groups and parent cycles", async () => {
    const { a, b, teamId } = await setup();
    const group = uuidv7();
    const red = uuidv7();
    const blue = uuidv7();
    a.mutate("issueLabelCreate", { id: group, name: "Color", color: "#000000", isGroup: true, groupType: "single" });
    a.mutate("issueLabelCreate", { id: red, name: "Red", color: "#ff0000", parentId: group });
    a.mutate("issueLabelCreate", { id: blue, name: "Blue", color: "#0000ff", parentId: group });
    const i1 = uuidv7();
    const i2 = uuidv7();
    a.mutate("issueCreate", { id: i1, teamId, title: "one", subscriptionId: uuidv7() });
    a.mutate("issueCreate", { id: i2, teamId, title: "two", parentId: i1, subscriptionId: uuidv7() });
    a.mutate("issueLabelsSet", { issueId: i1, add: [{ labelId: red, linkId: uuidv7() }], remove: [] });
    a.mutate("issueLabelsSet", { issueId: i1, add: [{ labelId: blue, linkId: uuidv7() }], remove: [] });
    await settle(a, b);
    expect(b.list("issueLabelLink", { issueId: i1 }).map((l) => l.labelId)).toEqual([blue]);
    expect(() => a.mutate("issueUpdate", { id: i1, patch: { parentId: i2 } })).toThrow(/cycle/);
  });

  it("system-only mutators cannot be called by users or agents", async () => {
    const { server } = await setup();
    const r = server.push(ALICE, {
      clientId: "x",
      mutations: [{ id: 1, name: "memberSync", args: { id: "u", name: "n", email: "e@x.io" }, ts: ts() }],
    });
    expect(r.ok && r.rejected[0]?.error).toMatch(/system-only/);
    expect(SYSTEM_ACTOR.type).toBe("system");
  });
});
