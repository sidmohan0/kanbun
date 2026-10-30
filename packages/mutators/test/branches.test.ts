import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { modelNames, type Row } from "@kanbun/model";
import { MemoryStore, type Actor, type BootstrapResponse, type Mutation, type PushRequest } from "@kanbun/sync";
import { SyncServer } from "@kanbun/sync/server";
import { openWorkspaceDb } from "@kanbun/sync/server/node";
import { mutators } from "../src";

const id = (n: number) => `019a0000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const ALICE = { id: "branch-alice", type: "user" } as const;
const BOB = { id: "branch-bob", type: "user" } as const;
const NOW = "2026-10-29T12:00:00.000Z";
const TEAM = id(10);
const OTHER_TEAM = id(20);
const MAIN_ISSUE = id(100);
const PROJECT = id(120);
const OTHER_PROJECT = id(121);

const command = (n: number, name: string, args: unknown, causationSeq?: number): Mutation => ({
  id: n,
  name,
  args,
  ts: NOW,
  ...(causationSeq === undefined ? {} : { causationSeq }),
});
const create = (issueId: string, subscriptionId: string, title = "Draft issue") => ({
  id: issueId,
  teamId: TEAM,
  title,
  subscriptionId,
});
const rename = (issueId: string, title: string) => ({ id: issueId, patch: { title } });

function push(server: SyncServer, clientId: string, mutations: Mutation[], branchId?: string, actor: Actor = ALICE) {
  return server.push(actor, { clientId, mutations, ...(branchId === undefined ? {} : { branchId }) });
}

function accepted(result: ReturnType<typeof push>) {
  expect(result).toMatchObject({ ok: true, rejected: [] });
}

function fixture(path?: string) {
  const { db, driver } = openWorkspaceDb(path);
  const server = new SyncServer({ driver, mutators, now: () => NOW });
  server.system("workspaceInit", {
    organization: { id: id(1), name: "Kanbun", urlKey: "branch-fixture" },
    owner: { id: ALICE.id, name: "Alice", email: "branch-alice@example.com" },
  });
  server.system("memberSync", { id: BOB.id, name: "Bob", email: "branch-bob@example.com" });
  accepted(
    push(server, "configuration", [
      ...[TEAM, OTHER_TEAM].map((teamId, index) =>
        command(index + 1, "teamCreate", {
          id: teamId,
          name: index ? "Other team" : "Team",
          key: index ? "OTHER" : "TEAM",
          visibility: index ? "private" : "public",
          membershipId: id(40 + index),
          stateIds: {
            backlog: id(50 + index * 10),
            todo: id(51 + index * 10),
            inProgress: id(52 + index * 10),
            done: id(53 + index * 10),
            canceled: id(54 + index * 10),
          },
        }),
      ),
    ]),
  );
  // Project commands land later; existing projection rows are the branch-scope prerequisite.
  for (const projectId of [PROJECT, OTHER_PROJECT])
    server.store.insert("project", {
      id: projectId,
      name: projectId === PROJECT ? "Launch" : "Other project",
      slugId: projectId,
      color: "#123456",
      statusId: id(122),
      prioritySortOrder: "a0",
      sortOrder: "a0",
      createdAt: NOW,
      updatedAt: NOW,
    } as Row<"project">);
  accepted(push(server, "main-writes", [command(1, "issueCreate", create(MAIN_ISSUE, id(101), "Live issue"))]));
  return { db, driver, server };
}

function mainProjection(server: SyncServer) {
  return Object.fromEntries(
    modelNames.map((model) => [model, server.store.list(model).sort((a, b) => a.id.localeCompare(b.id))]),
  );
}

function projectionRows(response: BootstrapResponse) {
  return Object.fromEntries(
    Object.entries(response.rows).map(([model, rows]) => [
      model,
      [...(rows ?? [])].sort((a, b) => String(a["id"]).localeCompare(String(b["id"]))),
    ]),
  );
}

function branchRows(server: SyncServer, branchId: string, clientId = "branch-reader") {
  return projectionRows(server.bootstrap(ALICE, clientId, branchId));
}

function applyPull(memory: MemoryStore, response: ReturnType<SyncServer["pull"]>) {
  expect(response.reset).toBe(false);
  for (const entry of response.entries) {
    if (entry.op === "delete") memory.delete(entry.model, entry.id);
    else memory.applyUpsert(entry.model, entry.id, entry.patch ?? {});
  }
}

describe("durable workspace branches", () => {
  it("persists branch ownership and edits across restart and identical retry without consuming main numbers", () => {
    const directory = mkdtempSync(join(tmpdir(), "kanbun-workspace-branch-"));
    const database = join(directory, "workspace.sqlite");
    let opened = fixture(database);
    const branchId = id(200);
    try {
      const main = mainProjection(opened.server);
      const cursor = opened.server.currentSeq();
      const mainHistory = opened.server.events(ALICE);
      const input = { id: branchId, name: "  Agent draft  ", scope: { teamIds: [TEAM, TEAM] } };
      const branch = opened.server.createBranch(ALICE, input);
      expect(branch).toMatchObject({
        id: branchId,
        name: "Agent draft",
        ownerId: ALICE.id,
        ownerType: "user",
        ownerUserId: ALICE.id,
        status: "open",
        baseSeq: mainHistory.at(-1)?.seq,
        scope: { teamIds: [TEAM], projectIds: [] },
      });
      expect(branch.baseSeq).not.toBe(cursor);
      expect(opened.server.createBranch(ALICE, input)).toEqual(branch);
      const request: PushRequest = {
        clientId: "durable-branch-client",
        branchId,
        mutations: [
          command(1, "issueCreate", create(id(201), id(202))),
          command(2, "issueUpdate", rename(MAIN_ISSUE, "Proposed rename")),
        ],
      };
      accepted(opened.server.push(ALICE, request));
      const rows = branchRows(opened.server, branchId);
      expect(rows["issue"]).toMatchObject([
        { id: MAIN_ISSUE, title: "Proposed rename", number: 1 },
        { id: id(201), title: "Draft issue", number: 0 },
      ]);
      expect(mainProjection(opened.server)).toEqual(main);
      expect(opened.server.currentSeq()).toBe(cursor);
      expect(opened.server.events(ALICE)).toEqual(mainHistory);
      const history = opened.server.events(ALICE, { branchId });
      expect(history.map((event) => event.type)).toEqual(["BranchCreated", "IssueCreated", "IssueTitled"]);
      expect(history[1]).toMatchObject({ branchId, payload: { number: 0 } });
      const branchCursor = opened.server.currentSeq(branchId);

      opened.db.close();
      const reopened = openWorkspaceDb(database);
      opened = { ...reopened, server: new SyncServer({ driver: reopened.driver, mutators, now: () => NOW }) };
      expect(opened.server.getBranch(ALICE, branchId)).toEqual(branch);
      expect(opened.server.createBranch(ALICE, input)).toEqual(branch);
      expect(branchRows(opened.server, branchId)).toEqual(rows);
      accepted(opened.server.push(ALICE, request));
      expect(opened.server.events(ALICE, { branchId })).toEqual(history);
      expect(opened.server.currentSeq(branchId)).toBe(branchCursor);
      expect(mainProjection(opened.server)).toEqual(main);

      accepted(push(opened.server, "main-writes", [command(2, "issueCreate", create(id(203), id(204), "Next live"))]));
      expect(opened.server.store.get("issue", id(203))?.number).toBe(2);
      expect(opened.server.store.get("issue", id(201))).toBeUndefined();
    } finally {
      opened.db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("pulls live main rows while preserving touched rows, including a first touch before the next pull", () => {
    const { db, server } = fixture();
    try {
      const branchId = id(210);
      server.createBranch(ALICE, { id: branchId, name: "Draft" });
      const siblingId = id(213);
      server.createBranch(ALICE, { id: siblingId, name: "Sibling" });
      const mainNotices: [number, string][] = [];
      const selectedNotices: [number, string][] = [];
      const siblingNotices: [number, string][] = [];
      server.onCommit((seq, affectedBranch) => mainNotices.push([seq, affectedBranch]));
      const unsubscribe = server.onCommit(
        (seq, affectedBranch) => selectedNotices.push([seq, affectedBranch]),
        branchId,
      );
      server.onCommit((seq, affectedBranch) => siblingNotices.push([seq, affectedBranch]), siblingId);
      const boot = server.bootstrap(ALICE, "pull-client", branchId);
      const canonical = new MemoryStore();
      for (const model of modelNames)
        for (const row of boot.rows[model] ?? []) canonical.insert(model, row as Row<typeof model>);

      accepted(push(server, "main-writes", [command(2, "issueUpdate", rename(MAIN_ISSUE, "Live change"))]));
      const mainNotice: [number, string] = [server.currentSeq(), "main"];
      expect(mainNotices).toEqual([mainNotice]);
      expect(selectedNotices).toEqual([mainNotice]);
      expect(siblingNotices).toEqual([mainNotice]);
      const live = server.pull(ALICE, { clientId: "pull-client", branchId, since: boot.seq });
      applyPull(canonical, live);
      expect(canonical.get("issue", MAIN_ISSUE)?.title).toBe("Live change");
      accepted(
        push(server, "branch-writes", [command(1, "issueUpdate", rename(MAIN_ISSUE, "Draft change"))], branchId),
      );
      expect(mainNotices).toEqual([mainNotice]);
      expect(siblingNotices).toEqual([mainNotice]);
      expect(selectedNotices).toEqual([mainNotice, [server.currentSeq(branchId), branchId]]);
      unsubscribe();
      accepted(
        push(server, "main-writes", [
          command(3, "issueUpdate", { id: MAIN_ISSUE, patch: { title: "Later live change", priority: 3 } }),
          command(4, "issueCreate", {
            ...create(id(211), id(212), "New live issue"),
            description: "Complete live row",
          }),
        ]),
      );
      accepted(
        push(server, "branch-writes", [command(2, "issueUpdate", rename(id(211), "Draft late issue"))], branchId),
      );
      accepted(push(server, "main-writes", [command(5, "issueUpdate", rename(id(211), "Later live late issue"))]));
      const response = server.pull(ALICE, { clientId: "pull-client", branchId, since: live.seq });
      applyPull(canonical, response);
      expect(canonical.get("issue", MAIN_ISSUE)?.title).toBe("Draft change");
      expect(canonical.get("issue", MAIN_ISSUE)?.priority).toBe(0);
      expect(canonical.get("issue", id(211))).toMatchObject({
        title: "Draft late issue",
        description: "Complete live row",
        number: 2,
        teamId: TEAM,
        stateId: id(50),
      });
      expect(server.store.get("issue", MAIN_ISSUE)?.title).toBe("Later live change");
      expect(server.store.get("issue", MAIN_ISSUE)?.priority).toBe(3);
      expect(server.store.get("issue", id(211))?.title).toBe("Later live late issue");
      expect(selectedNotices).toHaveLength(2);
      expect(mainNotices.map(([, affectedBranch]) => affectedBranch)).toEqual(["main", "main", "main"]);
      expect(siblingNotices).toEqual(mainNotices);
    } finally {
      db.close();
    }
  });

  it("enforces ownership, live membership, and proposer permissions on isolated branches", () => {
    const { db, server } = fixture();
    try {
      const proposer = { id: id(220), type: "agent" } as const;
      const sibling = { id: id(221), type: "agent" } as const;
      accepted(
        push(server, "agent-setup", [
          command(1, "agentCreate", {
            id: proposer.id,
            name: "Proposer",
            mode: "propose",
            scopes: { teamIds: [TEAM], projectIds: [PROJECT], mutators: [] },
          }),
          command(2, "agentCreate", { id: sibling.id, name: "Sibling", mode: "commit" }),
        ]),
      );
      const branchId = id(222);
      server.createBranch(proposer, { id: branchId, name: "Proposed work" });
      expect(server.getBranch(ALICE, branchId)).toMatchObject({ ownerId: proposer.id, ownerUserId: ALICE.id });
      const main = mainProjection(server);
      const denied = [
        () => server.getBranch(BOB, branchId),
        () => server.bootstrap(BOB, "outsider", branchId),
        () => server.pull(BOB, { clientId: "outsider", branchId, since: 0 }),
        () => server.load(BOB, { model: "comment", parentId: MAIN_ISSUE, branchId }),
        () => server.events(BOB, { branchId }),
        () => server.activity(BOB, { branchId }),
        () => server.getBranch(sibling, branchId),
      ];
      for (const read of denied) expect(read).toThrow(/branch not found/i);
      expect(
        push(server, "outsider", [command(1, "issueUpdate", rename(MAIN_ISSUE, "No"))], branchId, BOB),
      ).toMatchObject({ ok: false, code: "unauthorized" });
      const result = push(
        server,
        "proposer",
        [
          command(1, "issueCreate", { ...create(id(223), id(224)), projectId: OTHER_PROJECT }),
          command(2, "issueCreate", { ...create(id(225), id(226)), projectId: PROJECT }),
        ],
        branchId,
        proposer,
      );
      expect(result.ok && result.rejected).toMatchObject([
        { id: 1, error: expect.stringMatching(/scoped to projects/i) },
      ]);
      expect(branchRows(server, branchId)["issue"]).toContainEqual(expect.objectContaining({ id: id(225), number: 0 }));
      expect(branchRows(server, branchId)["issue"]).not.toContainEqual(expect.objectContaining({ id: id(223) }));
      expect(
        push(server, "proposer-main", [command(1, "issueCreate", create(id(227), id(228)))], undefined, proposer),
      ).toMatchObject({ ok: false, code: "unauthorized", error: expect.stringMatching(/propose/i) });
      expect(mainProjection(server)).toEqual(main);

      const privateBranch = id(260);
      const privateIssue = id(261);
      server.createBranch(ALICE, { id: privateBranch, name: "Private draft", scope: { teamIds: [OTHER_TEAM] } });
      accepted(
        push(
          server,
          "private-writes",
          [command(1, "issueCreate", { ...create(privateIssue, id(262)), teamId: OTHER_TEAM })],
          privateBranch,
        ),
      );
      const privateBoot = server.bootstrap(ALICE, "private-reader", privateBranch);
      expect(privateBoot.rows.issue).toContainEqual(expect.objectContaining({ id: privateIssue }));
      server.store.patch("teamMembership", id(41), { archivedAt: NOW });
      expect(
        server.pull(ALICE, { clientId: "private-reader", branchId: privateBranch, since: privateBoot.seq }).reset,
      ).toBe(true);
      expect(server.bootstrap(ALICE, "private-reader", privateBranch).rows.issue).not.toContainEqual(
        expect.objectContaining({ id: privateIssue }),
      );
      expect(server.events(ALICE, { branchId: privateBranch }).map((event) => event.type)).toEqual(["BranchCreated"]);
      expect(server.activity(ALICE, { branchId: privateBranch })).toEqual([]);
      const revoked = push(
        server,
        "private-writes",
        [
          command(2, "issueUpdate", rename(privateIssue, "Revoked edit")),
          command(3, "issueCreate", { ...create(id(263), id(264)), teamId: OTHER_TEAM }),
        ],
        privateBranch,
      );
      expect(revoked.ok && revoked.rejected.map((entry) => entry.id)).toEqual([2, 3]);

      server.store.patch("user", ALICE.id, { active: false });
      expect.soft(() => server.getBranch(ALICE, branchId)).toThrow(/active/i);
      expect.soft(() => server.getBranch(proposer, branchId)).toThrow(/active/i);
      expect.soft(() => server.createBranch(ALICE, { id: id(229), name: "Inactive" })).toThrow(/active/i);
      expect.soft(() => server.bootstrap(ALICE, "inactive", branchId)).toThrow(/active/i);
      expect
        .soft(push(server, "inactive", [command(1, "issueUpdate", rename(MAIN_ISSUE, "Inactive write"))], branchId))
        .toMatchObject({ ok: false, code: "unauthorized" });
    } finally {
      db.close();
    }
  });

  it("rolls back out-of-scope events and rejects legacy or mixed commands before branch writes", () => {
    const { db, server } = fixture();
    try {
      const branchId = id(230);
      server.createBranch(ALICE, { id: branchId, name: "Scoped", scope: { teamIds: [TEAM], projectIds: [PROJECT] } });
      const main = mainProjection(server);
      const result = push(
        server,
        "scoped",
        [
          command(1, "issueCreate", { ...create(id(231), id(232)), projectId: PROJECT }),
          command(2, "issueCreate", { ...create(id(233), id(234)), teamId: OTHER_TEAM, projectId: PROJECT }),
          command(3, "issueCreate", { ...create(id(235), id(236)), projectId: OTHER_PROJECT }),
          command(4, "issueUpdate", { id: MAIN_ISSUE, patch: { title: "Mixed", priority: 1 } }),
          command(5, "teamUpdate", { id: TEAM, patch: { name: "Legacy write" } }),
        ],
        branchId,
      );
      expect(result.ok && result.rejected.map((entry) => entry.id)).toEqual([2, 3, 4, 5]);
      expect(result.ok && result.rejected[0]?.error).toMatch(/branch is not scoped/i);
      expect(result.ok && result.rejected[1]?.error).toMatch(/scoped to projects/i);
      expect(result.ok && result.rejected.slice(2).every((entry) => /branch|supported|legacy/i.test(entry.error))).toBe(
        true,
      );
      expect(mainProjection(server)).toEqual(main);
      const rows = branchRows(server, branchId);
      expect(rows["issue"]).toMatchObject([
        { id: MAIN_ISSUE, title: "Live issue" },
        { id: id(231), number: 0 },
      ]);
      expect(server.events(ALICE, { branchId }).map((event) => event.type)).toEqual(["BranchCreated", "IssueCreated"]);
      expect(
        server
          .activity(ALICE, { branchId })
          .map((entry) => entry.model)
          .sort(),
      ).toEqual(["issue", "issueSubscription"]);
    } finally {
      db.close();
    }
  });

  it("binds client identities to one actor and branch and does not resolve causes from sibling branches", () => {
    const { db, server } = fixture();
    try {
      const left = id(240);
      const right = id(241);
      server.createBranch(ALICE, { id: left, name: "Left" });
      const rightBranch = server.createBranch(ALICE, { id: right, name: "Right" });
      expect(rightBranch.baseSeq).toBe(server.events(ALICE).at(-1)?.seq);
      server.bootstrap(ALICE, "left-client", left);
      accepted(push(server, "left-client", [command(1, "issueCreate", create(id(242), id(243)))], left));
      const source = server.activity(ALICE, { branchId: left, model: "issue", rowId: id(242) })[0]!;
      expect(() => server.bootstrap(ALICE, "left-client", right)).toThrow(/another workspace branch/i);
      expect(() => server.pull(ALICE, { clientId: "left-client", branchId: right, since: 0 })).toThrow(
        /another workspace branch/i,
      );
      expect(() => server.bootstrap(BOB, "left-client")).toThrow(/another actor/i);
      expect(
        push(server, "left-client", [command(2, "issueUpdate", rename(MAIN_ISSUE, "Wrong branch"))], right),
      ).toMatchObject({ ok: false, code: "unauthorized" });
      expect(push(server, "left-client", [command(2, "issueUpdate", rename(MAIN_ISSUE, "Wrong main"))])).toMatchObject({
        ok: false,
        code: "unauthorized",
      });

      accepted(push(server, "right-client", [command(1, "issueCreate", create(id(244), id(245)), source.seq)], right));
      expect(server.events(ALICE, { branchId: right }).at(-1)?.causationSeq).toBeNull();
      accepted(push(server, "main-writes", [command(2, "issueCreate", create(id(246), id(247)), source.seq)]));
      expect(server.events(ALICE).at(-1)?.causationSeq).toBeNull();
      const mainCause = server.activity(ALICE, { model: "issue", rowId: MAIN_ISSUE })[0]!;
      const mainEvent = server.events(ALICE, { entityId: MAIN_ISSUE })[0]!;
      accepted(
        push(
          server,
          "left-client",
          [command(2, "issueUpdate", rename(id(242), "From live main"), mainCause.seq)],
          left,
        ),
      );
      expect(server.events(ALICE, { branchId: left }).at(-1)?.causationSeq).toBe(mainEvent.seq);
      expect(server.events(ALICE).every((event) => event.branchId === "main")).toBe(true);
      expect(server.activity(ALICE).every((entry) => entry.id !== id(242) && entry.id !== id(244))).toBe(true);
      expect(
        server
          .bootstrap(ALICE, "live-reader")
          .rows.issue?.map((row) => row["id"])
          .sort(),
      ).toEqual([MAIN_ISSUE, id(246)]);
    } finally {
      db.close();
    }
  });

  it("atomically removes branch events, rows, and patches after a late projection failure", () => {
    const { db, server } = fixture();
    try {
      const branchId = id(250);
      server.createBranch(ALICE, { id: branchId, name: "Atomic draft" });
      accepted(push(server, "atomic", [command(1, "issueCreate", create(id(251), id(252)))], branchId));
      const main = mainProjection(server);
      const rows = branchRows(server, branchId);
      const history = server.events(ALICE, { branchId });
      const cursor = server.currentSeq(branchId);
      const failed = push(server, "atomic", [command(2, "issueCreate", create(id(253), id(252)))], branchId);
      expect(failed.ok && failed.rejected).toMatchObject([
        { id: 2, error: expect.stringMatching(/already exists|unique/i) },
      ]);
      expect(branchRows(server, branchId)).toEqual(rows);
      expect(server.events(ALICE, { branchId })).toEqual(history);
      expect(server.currentSeq(branchId)).toBe(cursor);
      expect(mainProjection(server)).toEqual(main);
      accepted(push(server, "atomic", [command(3, "issueCreate", create(id(254), id(255)))], branchId));
      expect(branchRows(server, branchId)["issue"]).toContainEqual(expect.objectContaining({ id: id(254), number: 0 }));
      accepted(push(server, "main-writes", [command(2, "issueCreate", create(id(256), id(257)))]));
      expect(server.store.get("issue", id(256))?.number).toBe(2);
    } finally {
      db.close();
    }
  });
});
