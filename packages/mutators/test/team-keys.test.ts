import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { modelNames, uuidv7 } from "@kanbun/model";
import { MemoryStore, type Actor } from "@kanbun/sync";
import { SyncServer } from "@kanbun/sync/server";
import { openWorkspaceDb } from "@kanbun/sync/server/node";
import { issueIdentifier, mutators } from "../src";

const owner: Actor = { id: "owner", type: "user" };
const member: Actor = { id: "member", type: "user" };
const now = "2026-10-30T12:00:00.000Z";
function setup(path = ":memory:") {
  const database = openWorkspaceDb(path);
  const server = new SyncServer({ driver: database.driver, mutators, now: () => now });
  server.system("workspaceInit", {
    organization: { id: uuidv7(), name: "Workspace", urlKey: "workspace" },
    owner: { id: owner.id, name: "Owner", email: "owner@example.com" },
  });
  server.system("memberSync", { id: member.id, name: "Member", email: "member@example.com" });
  function push(name: string, args: unknown, actor = owner) {
    return server.push(actor, { clientId: uuidv7(), mutations: [{ id: 1, name, args, ts: now }] });
  }
  function team(key: string) {
    const id = uuidv7();
    expect(
      push("teamCreate", {
        id,
        name: key,
        key,
        membershipId: uuidv7(),
        stateIds: {
          backlog: uuidv7(),
          todo: uuidv7(),
          inProgress: uuidv7(),
          done: uuidv7(),
          canceled: uuidv7(),
        },
      }),
    ).toMatchObject({ rejected: [] });
    return id;
  }
  const teamId = team("KAN");
  return { ...database, server, push, team, teamId };
}

it("renames the key identically in memory and SQLite without rewriting issues or links; numbering survives reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanbun-team-key-"));
  const path = join(dir, "workspace.sqlite");
  const f = setup(path);
  let closed = false;
  try {
    const first = uuidv7(),
      second = uuidv7();
    for (const id of [first, second])
      expect(f.push("issueCreate", { id, teamId: f.teamId, title: id, subscriptionId: uuidv7() })).toMatchObject({
        rejected: [],
      });
    const relationId = uuidv7();
    expect(
      f.push("issueRelationCreate", { id: relationId, issueId: first, relatedIssueId: second, type: "related" }),
    ).toMatchObject({ rejected: [] });
    const memory = new MemoryStore();
    for (const model of modelNames) for (const row of f.server.store.list(model)) memory.insert(model, row);
    const before = new Map(modelNames.map((model) => [model, structuredClone(f.server.store.list(model))]));
    const input = { id: f.teamId, patch: { key: "df" } };
    mutators.teamUpdate.run(
      { store: memory, actor: owner, actorId: owner.id, now, server: false },
      mutators.teamUpdate.args.parse(input),
    );
    expect(f.push("teamUpdate", input)).toMatchObject({ rejected: [] });
    for (const model of modelNames) {
      expect(memory.list(model)).toEqual(f.server.store.list(model));
      if (model !== "team") expect(f.server.store.list(model)).toEqual(before.get(model));
    }
    expect(f.server.store.get("team", f.teamId)).toMatchObject({ key: "DF", issueCounter: 2 });
    f.db.close();
    closed = true;
    const reopened = openWorkspaceDb(path);
    try {
      const server = new SyncServer({ driver: reopened.driver, mutators, now: () => now });
      const team = server.store.get("team", f.teamId)!;
      expect(issueIdentifier(team, server.store.get("issue", first)!)).toBe("DF-1");
      expect(issueIdentifier(team, server.store.get("issue", second)!)).toBe("DF-2");
      expect(server.store.get("issueRelation", relationId)).toMatchObject({ issueId: first, relatedIssueId: second });
      const next = uuidv7();
      expect(
        server.push(owner, {
          clientId: uuidv7(),
          mutations: [
            {
              id: 1,
              name: "issueCreate",
              ts: now,
              args: { id: next, teamId: f.teamId, title: "Next", subscriptionId: uuidv7() },
            },
          ],
        }),
      ).toMatchObject({ rejected: [] });
      expect(server.store.get("issue", next)!.number).toBe(3);
      expect(issueIdentifier(server.store.get("team", f.teamId)!, server.store.get("issue", next)!)).toBe("DF-3");
    } finally {
      reopened.db.close();
    }
  } finally {
    if (!closed) f.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("rejects case-insensitive collisions, invalid keys and members atomically while allowing an unchanged key", () => {
  const f = setup();
  try {
    const other = f.team("DF");
    for (const key of ["DF", "df", "Df"]) {
      expect(f.push("teamUpdate", { id: f.teamId, patch: { key, name: "Must roll back" } })).toMatchObject({
        rejected: [{ error: expect.stringMatching(/taken/) }],
      });
      expect(f.server.store.get("team", f.teamId)).toMatchObject({ key: "KAN", name: "KAN" });
    }
    for (const key of ["", "1ABC", "A-B", "TOOLONG8", " D F ", "é"])
      expect(f.push("teamUpdate", { id: f.teamId, patch: { key } })).toMatchObject({ rejected: [{}] });
    expect(f.push("teamUpdate", { id: f.teamId, patch: { key: "NEW" } }, member)).toMatchObject({
      rejected: [{ error: "team admin required" }],
    });
    expect(f.push("teamUpdate", { id: f.teamId, patch: { key: "kan" } })).toMatchObject({ rejected: [] });
    expect(f.server.store.get("team", f.teamId)!.key).toBe("KAN");
    expect(f.server.store.get("team", other)!.key).toBe("DF");
  } finally {
    f.db.close();
  }
});
