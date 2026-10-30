/**
 * Regression tests for the findings of the pre-commit engine review: scope
 * leaks through issue descendants, scope moves, reset acknowledgement,
 * insert-only creates, permission holes, replay isolation, client identity,
 * and agent budgets/scopes.
 */
import { describe, expect, it } from "vitest";
import { uuidv7 } from "@kanbun/model";
import type { Actor, Transport } from "@kanbun/sync";
import { MemoryPersister, SyncClient } from "@kanbun/sync/client";
import { SyncServer } from "@kanbun/sync/server";
import { openWorkspaceDb } from "@kanbun/sync/server/node";
import { mutators } from "../src";

const ALICE: Actor = { id: "user-alice", type: "user" };
const BOB: Actor = { id: "user-bob", type: "user" };
const ts = () => new Date().toISOString();
const states = () => ({ backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() });

function transportFor(server: SyncServer, actor: Actor): Transport {
  const tick = async <T>(fn: () => T): Promise<T> => {
    await Promise.resolve();
    return structuredClone(fn());
  };
  return {
    bootstrap: (clientId) => tick(() => server.bootstrap(actor, clientId)),
    push: (req) => tick(() => server.push(actor, structuredClone(req))),
    pull: (req) => tick(() => server.pull(actor, req)),
    load: (req) => tick(() => server.load(actor, req)),
  };
}

async function setup() {
  const { driver } = openWorkspaceDb();
  const server = new SyncServer({ driver, mutators });
  server.system("workspaceInit", {
    organization: { id: uuidv7(), name: "DataFog", urlKey: "datafog" },
    owner: { id: ALICE.id, name: "Alice A", email: "alice@example.com" },
  });
  server.system("memberSync", { id: BOB.id, name: "Bob B", email: "bob@example.com" });
  const publicTeam = uuidv7();
  const privateTeam = uuidv7();
  const publicStates = states();
  const privateStates = states();
  let n = 0;
  const push = (actor: Actor, clientId: string, ms: { name: string; args: unknown }[]) =>
    server.push(actor, { clientId, mutations: ms.map((m) => ({ id: ++n, ...m, ts: ts() })) });
  const r = push(ALICE, "alice-seed", [
    {
      name: "teamCreate",
      args: { id: publicTeam, name: "Public", key: "PUB", stateIds: publicStates, membershipId: uuidv7() },
    },
    {
      name: "teamCreate",
      args: {
        id: privateTeam,
        name: "Secret",
        key: "SEC",
        visibility: "private",
        stateIds: privateStates,
        membershipId: uuidv7(),
      },
    },
  ]);
  expect(r.ok && r.rejected).toEqual([]);
  const mk = (actor: Actor, clientId?: string, persister = new MemoryPersister()) =>
    new SyncClient({
      transport: transportFor(server, actor),
      mutators,
      actor,
      persister,
      pushDelayMs: 0,
      ...(clientId ? { clientId } : {}),
    });
  return { server, driver, publicTeam, privateTeam, publicStates, privateStates, mk };
}

const settle = async (...clients: SyncClient<typeof mutators>[]) => {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 2));
    for (const c of clients) {
      await c.push();
      await c.pull();
    }
  }
};

describe("scope", () => {
  it("rows hanging off a private issue are invisible to non-members, in bootstrap and in pulls", async () => {
    const { server, privateTeam, mk } = await setup();
    const a = mk(ALICE);
    const b = mk(BOB);
    await a.start();
    await b.start();
    const issueId = uuidv7();
    const labelId = uuidv7();
    a.mutate("issueLabelCreate", { id: labelId, name: "secret-label", color: "#ff0000", teamId: privateTeam });
    a.mutate("issueCreate", {
      id: issueId,
      teamId: privateTeam,
      title: "hush",
      subscriptionId: uuidv7(),
      labelIds: [labelId],
      labelLinkIds: [uuidv7()],
    });
    a.mutate("commentCreate", { id: uuidv7(), issueId, body: "secret comment" });
    a.mutate("issueSubscribe", { issueId, subscriptionId: uuidv7(), userId: BOB.id });
    await settle(a, b);

    expect(b.list("issueLabelLink")).toHaveLength(0);
    expect(b.list("issueSubscription")).toHaveLength(0);
    expect(server.bootstrap(BOB, "bob-fresh").rows["issueLabelLink"]).toHaveLength(0);
    expect(server.bootstrap(BOB, "bob-fresh").rows["issueSubscription"]).toHaveLength(0);
    expect(() => server.load(BOB, { model: "comment", parentId: issueId })).toThrow(/not visible/);
    expect(
      server.activity(BOB).filter((e) => e.model !== "user" && e.model !== "organization" && e.model !== "team"),
    ).toHaveLength(
      server
        .activity(BOB)
        .filter(
          (e) =>
            e.model === "workflowState" ||
            e.model === "teamMembership" ||
            e.model === "userSettings" ||
            e.model === "issueLabel",
        ).length,
    );
  });

  it("moving an issue between teams carries its children, and viewers who lose it see a delete", async () => {
    const { publicTeam, privateTeam, mk } = await setup();
    const a = mk(ALICE);
    const b = mk(BOB);
    await a.start();
    await b.start();
    const issueId = uuidv7();
    a.mutate("issueCreate", { id: issueId, teamId: privateTeam, title: "moving", subscriptionId: uuidv7() });
    a.mutate("commentCreate", { id: uuidv7(), issueId, body: "comes along" });
    await settle(a, b);
    expect(b.get("issue", issueId)).toBeUndefined();

    // Private -> public: Bob receives the whole row (not a fragment) and the children.
    a.mutate("issueUpdate", { id: issueId, patch: { teamId: publicTeam } });
    await settle(a, b);
    const seen = b.get("issue", issueId)!;
    expect(seen.title).toBe("moving");
    expect(seen.teamId).toBe(publicTeam);
    expect(seen.number).toBe(1);
    expect(b.list("issueSubscription", { issueId })).toHaveLength(1);
    expect(b.list("issueSubscription", { issueId })[0]!.teamId).toBe(publicTeam);
    await b.load("comment", issueId);
    expect(b.list("comment", { issueId })).toHaveLength(1);

    // Public -> private: Bob's copy is removed.
    a.mutate("issueUpdate", { id: issueId, patch: { teamId: privateTeam } });
    await settle(a, b);
    expect(b.get("issue", issueId)).toBeUndefined();
    expect(b.list("issueSubscription", { issueId })).toHaveLength(0);
    expect(b.list("comment", { issueId })).toHaveLength(0);
    expect(a.get("issue", issueId)?.teamId).toBe(privateTeam);
  });

  it("keeps answering reset until the client bootstraps again", async () => {
    const { server, privateTeam } = await setup();
    const clientId = "bob-1";
    server.bootstrap(BOB, clientId);
    expect(server.pull(BOB, { clientId, since: 0 }).reset).toBe(false);
    const r = server.push(ALICE, {
      clientId: "alice-2",
      mutations: [
        { id: 1, name: "teamMembershipCreate", args: { id: uuidv7(), teamId: privateTeam, userId: BOB.id }, ts: ts() },
      ],
    });
    expect(r.ok).toBe(true);
    expect(server.pull(BOB, { clientId, since: 0 }).reset).toBe(true);
    // Not acknowledged yet (no bootstrap): still reset.
    expect(server.pull(BOB, { clientId, since: 0 }).reset).toBe(true);
    server.bootstrap(BOB, clientId);
    expect(server.pull(BOB, { clientId, since: 0 }).reset).toBe(false);
    // A client that never bootstrapped is told to.
    expect(server.pull(BOB, { clientId: "never-bootstrapped", since: 0 }).reset).toBe(true);
  });
});

describe("creates and permissions", () => {
  it("creating with an existing id is rejected and overwrites nothing", async () => {
    const { server, publicTeam } = await setup();
    const id = uuidv7();
    const push = (mid: number, args: unknown) =>
      server.push(BOB, { clientId: "bob", mutations: [{ id: mid, name: "issueCreate", args, ts: ts() }] });
    expect(push(1, { id, teamId: publicTeam, title: "original", subscriptionId: uuidv7() }).ok).toBe(true);
    const dup = push(2, { id, teamId: publicTeam, title: "hijack", subscriptionId: uuidv7() });
    expect(dup.ok && dup.rejected[0]?.error).toMatch(/already exists/);
    expect(server.store.get("issue", id)?.title).toBe("original");
    expect(server.store.get("issue", id)?.number).toBe(1);
    expect(server.store.get("team", publicTeam)?.issueCounter).toBe(1);
  });

  it("granting ownership on a public team takes an admin", async () => {
    const { server, publicTeam, driver } = await setup();
    driver.run(`UPDATE user SET role = 'user' WHERE id = ?`, [BOB.id]);
    const r = server.push(BOB, {
      clientId: "bob",
      mutations: [
        {
          id: 1,
          name: "teamMembershipCreate",
          args: { id: uuidv7(), teamId: publicTeam, userId: BOB.id, owner: true },
          ts: ts(),
        },
        { id: 2, name: "teamMembershipCreate", args: { id: uuidv7(), teamId: publicTeam, userId: BOB.id }, ts: ts() },
      ],
    });
    expect(r.ok && r.rejected.map((x) => x.id)).toEqual([1]);
    expect(server.store.list("teamMembership", { teamId: publicTeam, userId: BOB.id })[0]?.owner).toBe(false);
  });

  it("resolving, reacting, editing and unsubscribing on an invisible issue are refused", async () => {
    const { server, privateTeam } = await setup();
    const issueId = uuidv7();
    const commentId = uuidv7();
    const seed = server.push(ALICE, {
      clientId: "alice",
      mutations: [
        {
          id: 1,
          name: "issueCreate",
          args: { id: issueId, teamId: privateTeam, title: "hush", subscriptionId: uuidv7() },
          ts: ts(),
        },
        { id: 2, name: "commentCreate", args: { id: commentId, issueId, body: "private" }, ts: ts() },
      ],
    });
    expect(seed.ok && seed.rejected).toEqual([]);
    const r = server.push(BOB, {
      clientId: "bob",
      mutations: [
        { id: 1, name: "commentResolve", args: { id: commentId, resolved: true }, ts: ts() },
        { id: 2, name: "reactionToggle", args: { id: uuidv7(), emoji: "👀", commentId }, ts: ts() },
        { id: 3, name: "reactionToggle", args: { id: uuidv7(), emoji: "👀", issueId }, ts: ts() },
        { id: 4, name: "issueUnsubscribe", args: { issueId, userId: ALICE.id }, ts: ts() },
        { id: 5, name: "commentUpdate", args: { id: commentId, body: "defaced" }, ts: ts() },
      ],
    });
    expect(r.ok && r.rejected.map((x) => x.id)).toEqual([1, 2, 3, 4, 5]);
    expect(server.store.get("comment", commentId)?.body).toBe("private");
    expect(server.store.list("reaction")).toHaveLength(0);
    expect(server.store.list("issueSubscription", { issueId })).toHaveLength(1);
  });

  it("a reaction to a comment belongs to the comment's issue and carries its team", async () => {
    const { server, publicTeam } = await setup();
    const issueId = uuidv7();
    const commentId = uuidv7();
    const r = server.push(ALICE, {
      clientId: "alice",
      mutations: [
        {
          id: 1,
          name: "issueCreate",
          args: { id: issueId, teamId: publicTeam, title: "t", subscriptionId: uuidv7() },
          ts: ts(),
        },
        { id: 2, name: "commentCreate", args: { id: commentId, issueId, body: "c" }, ts: ts() },
        { id: 3, name: "reactionToggle", args: { id: uuidv7(), emoji: "🎉", commentId }, ts: ts() },
      ],
    });
    expect(r.ok && r.rejected).toEqual([]);
    const reaction = server.store.list("reaction")[0]!;
    expect(reaction.issueId).toBe(issueId);
    expect(reaction.commentId).toBe(commentId);
    expect(reaction.teamId).toBe(publicTeam);
  });

  it("two children of a single-select group in one add leave one label", async () => {
    const { server, publicTeam } = await setup();
    const issueId = uuidv7();
    const group = uuidv7();
    const l1 = uuidv7();
    const l2 = uuidv7();
    const r = server.push(ALICE, {
      clientId: "alice",
      mutations: [
        {
          id: 1,
          name: "issueLabelCreate",
          args: { id: group, name: "Size", color: "#000000", isGroup: true, groupType: "single" },
          ts: ts(),
        },
        { id: 2, name: "issueLabelCreate", args: { id: l1, name: "S", color: "#000000", parentId: group }, ts: ts() },
        { id: 3, name: "issueLabelCreate", args: { id: l2, name: "M", color: "#000000", parentId: group }, ts: ts() },
        {
          id: 4,
          name: "issueCreate",
          args: { id: issueId, teamId: publicTeam, title: "t", subscriptionId: uuidv7() },
          ts: ts(),
        },
        {
          id: 5,
          name: "issueLabelsSet",
          args: {
            issueId,
            add: [
              { labelId: l1, linkId: uuidv7() },
              { labelId: l2, linkId: uuidv7() },
            ],
            remove: [],
          },
          ts: ts(),
        },
        {
          id: 6,
          name: "issueLabelsSet",
          args: { issueId, add: [{ labelId: group, linkId: uuidv7() }], remove: [] },
          ts: ts(),
        },
      ],
    });
    expect(r.ok && r.rejected.map((x) => x.id)).toEqual([6]);
    expect(server.store.list("issueLabelLink", { issueId }).map((l) => l.labelId)).toEqual([l2]);
  });
});

describe("client", () => {
  it("a pending mutation that fails to replay stays queued and the server decides", async () => {
    const { server, publicTeam, publicStates, mk } = await setup();
    const a = mk(ALICE);
    const b = mk(BOB);
    await a.start();
    await b.start();
    const issueId = uuidv7();
    a.mutate("issueCreate", { id: issueId, teamId: publicTeam, title: "t", subscriptionId: uuidv7() });
    await settle(a, b);

    // Bob, offline from pushes, edits; Alice trashes and deletes the issue meanwhile.
    const rejected: string[] = [];
    b["opts"].onRejected = (m) => rejected.push(m.name);
    b.mutate("issueUpdate", { id: issueId, patch: { stateId: publicStates.todo } });
    b.mutate("commentCreate", { id: uuidv7(), issueId, body: "late" });
    const after = uuidv7();
    b.mutate("issueCreate", { id: after, teamId: publicTeam, title: "after", subscriptionId: uuidv7() });
    expect(b.pendingCount()).toBe(3);
    a.mutate("issueTrash", { id: issueId, trashed: true });
    a.mutate("issueDelete", { id: issueId });
    await a.push();
    await b.pull(); // rebase: the two edits on the deleted issue no longer apply locally
    expect(b.pendingCount()).toBe(3);
    expect(b.get("issue", after)?.title).toBe("after");
    expect(b.get("issue", issueId)).toBeUndefined();

    await settle(a, b);
    expect(b.pendingCount()).toBe(0);
    expect(server.store.get("issue", after)?.number).toBe(2);
    expect(server.store.get("issue", issueId)).toBeUndefined();
    expect(rejected).toContain("issueUpdate");
  });

  it("a mutator that writes and then throws leaves nothing behind", async () => {
    const { publicTeam, mk } = await setup();
    const a = mk(ALICE);
    await a.start();
    const issueId = uuidv7();
    const subscriptionId = uuidv7();
    a.mutate("issueCreate", { id: issueId, teamId: publicTeam, title: "t", subscriptionId });
    // The second reducer inserts its issue, then the duplicate subscription id throws.
    const bad = uuidv7();
    expect(() =>
      a.mutate("issueCreate", {
        id: bad,
        teamId: publicTeam,
        title: "half",
        subscriptionId,
      }),
    ).toThrow(/already exists/);
    expect(a.get("issue", bad)).toBeUndefined();
    expect(a.list("issue")).toHaveLength(1);
    expect(a.pendingCount()).toBe(1);
  });

  it("recovers its client id from the persister across restarts", async () => {
    const { server, publicTeam, mk } = await setup();
    const persister = new MemoryPersister();
    const first = mk(ALICE, undefined, persister);
    await first.start();
    first.mutate("issueCreate", { id: uuidv7(), teamId: publicTeam, title: "one", subscriptionId: uuidv7() });
    await settle(first);
    const second = mk(ALICE, undefined, persister);
    await second.start();
    expect(second.clientId).toBe(first.clientId);
    second.mutate("issueCreate", { id: uuidv7(), teamId: publicTeam, title: "two", subscriptionId: uuidv7() });
    await settle(second);
    expect(second.pendingCount()).toBe(0);
    expect(server.store.list("issue")).toHaveLength(2);
    const row = server["opts"].driver.all(`SELECT last_mutation_id FROM sync_client WHERE client_id = ?`, [
      first.clientId,
    ])[0];
    expect(row?.["last_mutation_id"]).toBe(2);
  });

  it("a failed pull rejects so a push recovering from a gap does not spin", async () => {
    const { mk, publicTeam } = await setup();
    const a = mk(ALICE);
    await a.start();
    const t = a["opts"].transport;
    let pulls = 0;
    a["opts"].transport = {
      ...t,
      push: async () => ({ ok: false as const, error: "gap", code: "gap" as const }),
      pull: async () => {
        pulls++;
        throw new Error("down");
      },
    };
    a.mutate("issueCreate", { id: uuidv7(), teamId: publicTeam, title: "t", subscriptionId: uuidv7() });
    await a.push();
    expect(a.getStatus()).toBe("offline");
    expect(pulls).toBe(1);
    expect(a.pendingCount()).toBe(1);
  });
});

describe("agents", () => {
  const withAgent = async (
    scopes: { teamIds: string[]; projectIds: string[]; mutators: string[] },
    rateBudget = 10,
  ) => {
    const s = await setup();
    const agentId = uuidv7();
    const r = s.server.push(ALICE, {
      clientId: "alice",
      mutations: [
        {
          id: 1,
          name: "agentCreate",
          args: { id: agentId, name: "bot", mode: "commit", scopes, rateBudget },
          ts: ts(),
        },
      ],
    });
    expect(r.ok && r.rejected).toEqual([]);
    return { ...s, AGENT: { id: agentId, type: "agent" } as Actor };
  };

  it("retries of applied mutations do not count against the budget", async () => {
    const { server, publicTeam, AGENT } = await withAgent({ teamIds: [], projectIds: [], mutators: [] }, 3);
    const ms = [1, 2, 3].map((id) => ({
      id,
      name: "issueCreate",
      args: { id: uuidv7(), teamId: publicTeam, title: `i${id}`, subscriptionId: uuidv7() },
      ts: ts(),
    }));
    expect(server.push(AGENT, { clientId: "bot", mutations: ms }).ok).toBe(true);
    // Same batch again (lost response): nothing new, so within budget.
    const again = server.push(AGENT, { clientId: "bot", mutations: ms });
    expect(again.ok && again.lastMutationId).toBe(3);
    const fourth = server.push(AGENT, {
      clientId: "bot",
      mutations: [
        {
          id: 4,
          name: "issueCreate",
          args: { id: uuidv7(), teamId: publicTeam, title: "i4", subscriptionId: uuidv7() },
          ts: ts(),
        },
      ],
    });
    expect(fourth.ok).toBe(false);
    expect(!fourth.ok && fourth.error).toMatch(/budget/);
  });

  it("project scope is enforced on every issue an agent writes", async () => {
    const s = await withAgent({ teamIds: [], projectIds: [], mutators: [] });
    const { server, publicTeam, AGENT } = s;
    const projectId = uuidv7(); // project rows get their mutators in phase 1; the scope check only reads issue.project_id
    const inProject = uuidv7();
    const outside = uuidv7();
    const seed = server.push(ALICE, {
      clientId: "alice-2",
      mutations: [
        {
          id: 1,
          name: "issueCreate",
          args: { id: inProject, teamId: publicTeam, title: "in", projectId, subscriptionId: uuidv7() },
          ts: ts(),
        },
        {
          id: 2,
          name: "issueCreate",
          args: { id: outside, teamId: publicTeam, title: "out", subscriptionId: uuidv7() },
          ts: ts(),
        },
        {
          id: 3,
          name: "agentUpdate",
          args: { id: AGENT.id, patch: { scopes: { teamIds: [], projectIds: [projectId], mutators: [] } } },
          ts: ts(),
        },
      ],
    });
    expect(seed.ok && seed.rejected).toEqual([]);
    const r = server.push(AGENT, {
      clientId: "bot",
      mutations: [
        { id: 1, name: "issueUpdate", args: { id: inProject, patch: { priority: 2 } }, ts: ts() },
        { id: 2, name: "issueUpdate", args: { id: outside, patch: { priority: 2 } }, ts: ts() },
        {
          id: 3,
          name: "issueCreate",
          args: { id: uuidv7(), teamId: publicTeam, title: "no project", subscriptionId: uuidv7() },
          ts: ts(),
        },
      ],
    });
    expect(r.ok && r.rejected.map((x) => x.id)).toEqual([2, 3]);
    expect(server.store.get("issue", inProject)?.priority).toBe(2);
    expect(server.store.get("issue", outside)?.priority).toBe(0);
  });
});
