import { expect, it } from "vitest";
import { uuidv7 } from "@kanbun/model";
import { MemoryStore, type MutatorContext } from "@kanbun/sync";
import { SyncServer } from "@kanbun/sync/server";
import { openWorkspaceDb } from "@kanbun/sync/server/node";
import { applyIssueEvent, mutators } from "../src";

const alice = { id: "alice", type: "user" } as const;
const bob = { id: "bob", type: "user" } as const;
const now = "2026-10-30T00:00:00.000Z";
function fixture() {
  const { db, driver } = openWorkspaceDb();
  const server = new SyncServer({ driver, mutators, now: () => now });
  server.system("workspaceInit", {
    organization: { id: uuidv7(), name: "Kanbun", urlKey: "kanbun" },
    owner: { id: alice.id, name: "Alice", email: "alice@example.com" },
  });
  server.system("memberSync", { id: bob.id, name: "Bob", email: "bob@example.com" });
  const team = uuidv7(),
    otherTeam = uuidv7();
  const mutationIds = new Map<string, number>();
  const push = (name: string, args: unknown, actor = alice as { id: string; type: "user" }) => {
    const id = (mutationIds.get(actor.id) ?? 0) + 1;
    mutationIds.set(actor.id, id);
    return server.push(actor, { clientId: `relationships-${actor.id}`, mutations: [{ id, name, args, ts: now }] });
  };
  for (const [id, key] of [
    [team, "ONE"],
    [otherTeam, "TWO"],
  ]) {
    expect(
      push("teamCreate", {
        id,
        key,
        name: key,
        membershipId: uuidv7(),
        stateIds: { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() },
      }),
    ).toMatchObject({ ok: true, rejected: [] });
  }
  const a = uuidv7(),
    b = uuidv7(),
    c = uuidv7();
  for (const [id, teamId] of [
    [a, team],
    [b, otherTeam],
    [c, team],
  ])
    expect(push("issueCreate", { id, teamId, title: id, subscriptionId: uuidv7() })).toMatchObject({
      ok: true,
      rejected: [],
    });
  return { db, server, push, team, otherTeam, a, b, c };
}

it("validates cross-team hierarchy and dependency graphs, deduplicates symmetric links, and replays recorded facts", () => {
  const { db, server, push, a, b, c } = fixture();
  try {
    const memory = new MemoryStore();
    for (const issue of server.store.list("issue")) memory.insert("issue", structuredClone(issue));
    const since = server.events(alice).at(-1)!.seq;
    expect(push("issueUpdate", { id: b, patch: { parentId: a } })).toMatchObject({ ok: true, rejected: [] });
    expect(push("issueUpdate", { id: c, patch: { parentId: b } })).toMatchObject({ ok: true, rejected: [] });
    expect(push("issueUpdate", { id: a, patch: { parentId: c, title: "Must roll back" } })).toMatchObject({
      rejected: [{ error: expect.stringMatching(/cycle/i) }],
    });
    expect(server.store.get("issue", a)!.title).toBe(a);
    expect(push("issueUpdate", { id: a, patch: { parentId: a } })).toMatchObject({ rejected: [{}] });
    const link = uuidv7();
    expect(push("issueRelationCreate", { id: link, issueId: a, relatedIssueId: b, type: "blocks" })).toMatchObject({
      rejected: [],
    });
    expect(push("issueRelationCreate", { id: uuidv7(), issueId: b, relatedIssueId: c, type: "blocks" })).toMatchObject({
      rejected: [],
    });
    expect(push("issueRelationCreate", { id: uuidv7(), issueId: c, relatedIssueId: a, type: "blocks" })).toMatchObject({
      rejected: [{ error: expect.stringMatching(/cycle/i) }],
    });
    expect(push("issueRelationCreate", { id: uuidv7(), issueId: a, relatedIssueId: a, type: "related" })).toMatchObject(
      { rejected: [{}] },
    );
    expect(push("issueRelationCreate", { id: uuidv7(), issueId: a, relatedIssueId: c, type: "related" })).toMatchObject(
      { rejected: [] },
    );
    expect(push("issueRelationCreate", { id: uuidv7(), issueId: c, relatedIssueId: a, type: "related" })).toMatchObject(
      { rejected: [] },
    );
    expect(server.store.list("issueRelation")).toHaveLength(3);
    expect(push("issueRelationDelete", { id: link })).toMatchObject({ rejected: [] });
    const context: MutatorContext = { store: memory, actor: alice, actorId: alice.id, now, server: false };
    const events = server.events(alice, { since });
    for (const event of events) applyIssueEvent(context, event);
    const sorted = <T extends { id: string }>(rows: T[]) => rows.sort((left, right) => left.id.localeCompare(right.id));
    expect(sorted(memory.list("issue"))).toEqual(sorted(server.store.list("issue")));
    expect(sorted(memory.list("issueRelation"))).toEqual(sorted(server.store.list("issueRelation")));
    expect(events.map((event) => event.type)).toContain("IssueParentChanged");
    expect(events.map((event) => event.type)).toContain("IssueRelationRemoved");
  } finally {
    db.close();
  }
});

it("revokes and restores references in existing caches and history when either endpoint changes visibility", () => {
  const { db, server, push, team, otherTeam, a, b, c } = fixture();
  try {
    const link = uuidv7();
    expect(push("issueUpdate", { id: a, patch: { parentId: b } })).toMatchObject({ rejected: [] });
    expect(push("issueRelationCreate", { id: link, issueId: a, relatedIssueId: b, type: "blocks" })).toMatchObject({
      rejected: [],
    });
    const initial = server.bootstrap(bob, "bob-view");
    expect(initial.rows.issueRelation).toHaveLength(1);
    expect(push("teamUpdate", { id: otherTeam, patch: { visibility: "private" } })).toMatchObject({ rejected: [] });
    expect(server.pull(bob, { clientId: "bob-view", since: initial.seq })).toMatchObject({ reset: true });
    const privateView = server.bootstrap(bob, "bob-view");
    expect(privateView.rows.issueRelation).toHaveLength(0);
    expect(privateView.rows.issue!.find((row) => row.id === a)).toMatchObject({ parentId: null });
    expect(JSON.stringify(server.events(bob))).not.toContain(b);
    expect(JSON.stringify(server.activity(bob))).not.toContain(b);
    expect(push("issueUpdate", { id: a, patch: { parentId: b } }, bob)).toMatchObject({ rejected: [{}] });
    // Editing the authorized child's field does not require access to its hidden old parent.
    expect(push("issueUpdate", { id: a, patch: { parentId: null } }, bob)).toMatchObject({ rejected: [] });
    expect(server.store.get("issue", a)!.parentId).toBeNull();
    expect(push("issueUpdate", { id: a, patch: { parentId: b } })).toMatchObject({ rejected: [] });
    expect(push("issueUpdate", { id: a, patch: { parentId: c } }, bob)).toMatchObject({ rejected: [] });
    expect(server.store.get("issue", a)!.parentId).toBe(c);
    expect(push("issueUpdate", { id: a, patch: { parentId: b } })).toMatchObject({ rejected: [] });
    expect(push("issueRelationDelete", { id: link }, bob)).toMatchObject({ rejected: [{}] });
    expect(
      push("issueRelationCreate", { id: uuidv7(), issueId: a, relatedIssueId: b, type: "related" }, bob),
    ).toMatchObject({ rejected: [{}] });
    // The visible source stays in its team; moving the target alone refreshes its references.
    expect(push("issueUpdate", { id: b, patch: { teamId: team } })).toMatchObject({ rejected: [] });
    const publicAgain = server.pull(bob, { clientId: "bob-view", since: privateView.seq });
    expect(publicAgain.reset).toBe(false);
    expect(publicAgain.entries).toContainEqual(
      expect.objectContaining({
        model: "issueRelation",
        id: link,
        op: "upsert",
        patch: expect.objectContaining({ relatedIssueId: b }),
      }),
    );
    expect(publicAgain.entries).toContainEqual(
      expect.objectContaining({ model: "issue", id: a, patch: expect.objectContaining({ parentId: b }) }),
    );
    expect(push("issueUpdate", { id: b, patch: { teamId: otherTeam } })).toMatchObject({ rejected: [] });
    const privateAgain = server.pull(bob, { clientId: "bob-view", since: publicAgain.seq });
    expect(privateAgain.entries).toContainEqual(
      expect.objectContaining({ model: "issueRelation", id: link, op: "delete", patch: null }),
    );
    expect(privateAgain.entries).toContainEqual(
      expect.objectContaining({ model: "issue", id: a, patch: expect.objectContaining({ parentId: null }) }),
    );
    expect(JSON.stringify(privateAgain.entries)).not.toContain(`"relatedIssueId":"${b}"`);
    expect(JSON.stringify(server.events(bob))).not.toContain(b);
    expect(JSON.stringify(server.activity(bob))).not.toContain(b);
    expect(server.store.get("issue", a)!.parentId).toBe(b);
    expect(server.store.get("issueRelation", link)!.relatedIssueId).toBe(b);
  } finally {
    db.close();
  }
});
