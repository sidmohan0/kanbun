import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { modelNames } from "@kanbun/model";
import type { Actor, Mutation } from "@kanbun/sync";
import { SyncServer } from "@kanbun/sync/server";
import { openWorkspaceDb } from "@kanbun/sync/server/node";
import { mutators } from "../src";

const id = (n: number) => `019a0000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const ALICE = { id: "merge-alice", type: "user" } as const;
const BOB = { id: "merge-bob", type: "user" } as const;
const NOW = "2026-10-29T12:00:00.000Z";
const TEAM = id(10);
const PRIVATE_TEAM = id(20);
const MAIN_ISSUE = id(100);
const PRIVATE_ISSUE = id(101);

const command = (n: number, name: string, args: unknown): Mutation => ({ id: n, name, args, ts: NOW });
const create = (issueId: string, subscriptionId: string, title = "Proposed issue", teamId = TEAM) => ({
  id: issueId,
  teamId,
  title,
  subscriptionId,
});
const rename = (issueId: string, title: string) => ({ id: issueId, patch: { title } });

function accepted(result: ReturnType<SyncServer["push"]>) {
  expect(result).toMatchObject({ ok: true, rejected: [] });
}

function push(server: SyncServer, clientId: string, mutations: Mutation[], branchId?: string, actor: Actor = ALICE) {
  const result = server.push(actor, { clientId, mutations, ...(branchId === undefined ? {} : { branchId }) });
  accepted(result);
  return result;
}

function fixture(path?: string) {
  const { db, driver } = openWorkspaceDb(path);
  const server = new SyncServer({ driver, mutators, now: () => NOW });
  server.system("workspaceInit", {
    organization: { id: id(1), name: "Kanbun", urlKey: "merge-fixture" },
    owner: { id: ALICE.id, name: "Alice", email: "merge-alice@example.com" },
  });
  server.system("memberSync", { id: BOB.id, name: "Bob", email: "merge-bob@example.com" });
  push(
    server,
    "configuration",
    [TEAM, PRIVATE_TEAM].map((teamId, index) =>
      command(index + 1, "teamCreate", {
        id: teamId,
        name: index ? "Private" : "Team",
        key: index ? "PRIVATE" : "TEAM",
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
  );
  push(server, "main", [
    command(1, "issueCreate", create(MAIN_ISSUE, id(102), "Live issue")),
    command(2, "issueCreate", create(PRIVATE_ISSUE, id(103), "Private live issue", PRIVATE_TEAM)),
  ]);
  return { db, driver, server };
}

function mainProjection(server: SyncServer) {
  return Object.fromEntries(
    modelNames.map((model) => [model, server.store.list(model).sort((a, b) => a.id.localeCompare(b.id))]),
  );
}

function request(server: SyncServer, branchId: string, mergeId: string) {
  const preview = server.previewBranch(ALICE, branchId);
  return {
    branchId,
    mergeId,
    expectedBranchHeadSeq: preview.branchHeadSeq,
    expectedMainSyncSeq: preview.mainSyncSeq,
  };
}

/** Validation can reject before replay or fail during SQL application; neither may partially commit. */
function expectFailure(operation: () => ReturnType<SyncServer["mergeBranch"]>) {
  let result: ReturnType<SyncServer["mergeBranch"]>;
  try {
    result = operation();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return;
  }
  expect(result.ok).toBe(false);
}

describe("reviewing and merging workspace branches", () => {
  it("merges a 500-event branch atomically and allocates main numbers only once", () => {
    const { db, driver, server } = fixture();
    try {
      const branchId = id(300);
      server.createBranch(ALICE, { id: branchId, name: "Large proposal", scope: { teamIds: [TEAM] } });
      const mutations: Mutation[] = [];
      for (let index = 0; index < 250; index++) {
        const issueId = id(1000 + index * 2);
        mutations.push(
          command(index * 2 + 1, "issueCreate", {
            ...create(issueId, id(1001 + index * 2)),
            ...(index === 0 ? { position: "top" } : {}),
          }),
        );
        mutations.push(command(index * 2 + 2, "issueUpdate", rename(issueId, `Reviewed proposal ${index}`)));
      }
      push(server, "large-proposal", mutations, branchId);
      expect(server.store.get("team", TEAM)?.issueCounter).toBe(1);
      expect(server.store.list("issue")).toHaveLength(2);
      const unrelatedIssue = id(1900);
      push(server, "main", [command(3, "issueCreate", { ...create(unrelatedIssue, id(1901)), position: "top" })]);
      const mainTop = server.store.get("issue", unrelatedIssue)!.sortOrder;
      const preview = server.previewBranch(ALICE, branchId);
      expect(preview.conflicts).toEqual([]);
      expect(preview.changes).toHaveLength(250);
      const merge = server.mergeBranch(ALICE, {
        branchId,
        mergeId: id(301),
        expectedBranchHeadSeq: preview.branchHeadSeq,
        expectedMainSyncSeq: preview.mainSyncSeq,
      });
      expect(merge).toMatchObject({ ok: true, appliedEvents: 500, skippedEntities: 0 });
      if (!merge.ok) throw new Error("Clean proposal did not merge");
      expect(server.store.get("team", TEAM)?.issueCounter).toBe(252);
      const proposed = server.store
        .list("issue")
        .filter((issue) => issue.id !== MAIN_ISSUE && issue.id !== PRIVATE_ISSUE && issue.id !== unrelatedIssue);
      expect(proposed).toHaveLength(250);
      expect(proposed.map((issue) => issue.number).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 250 }, (_, index) => index + 3),
      );
      expect(server.store.get("issue", id(1000))!.sortOrder < mainTop).toBe(true);
      expect(server.store.get("issue", id(1000))?.title).toBe("Reviewed proposal 0");
      expect(server.store.get("issue", id(1498))?.title).toBe("Reviewed proposal 249");
      const history = server.events(ALICE, { limit: 5000 });
      expect(history.find((event) => event.seq === merge.mergeEventSeq)?.type).toBe("BranchMerged");
      expect(history.filter((event) => event.causationSeq === merge.mergeEventSeq)).toHaveLength(500);
      expect(server.getBranch(ALICE, branchId).status).toBe("merged");
      expect(driver.all("SELECT COUNT(*) AS count FROM branch_row WHERE branch_id = ?", [branchId])).toEqual([
        { count: 0 },
      ]);
      expect(() => server.bootstrap(ALICE, "closed-reader", branchId)).toThrow(/open|merged|closed/i);
      expect(
        server.push(ALICE, {
          clientId: "large-proposal",
          branchId,
          mutations: [command(501, "issueUpdate", rename(id(1000), "After closure"))],
        }),
      ).toMatchObject({ ok: false, code: "unauthorized" });
    } finally {
      db.close();
    }
  });

  it("detects semantic and legacy main edits and refuses stale conflict choices", () => {
    const { db, server } = fixture();
    try {
      const branchId = id(310);
      server.createBranch(ALICE, { id: branchId, name: "Competing edits" });
      push(
        server,
        "proposal",
        [
          command(1, "issueUpdate", rename(MAIN_ISSUE, "Branch semantic title")),
          command(2, "issueUpdate", rename(PRIVATE_ISSUE, "Branch legacy title")),
        ],
        branchId,
      );
      const previousSemanticSeq = server.store.get("issue", PRIVATE_ISSUE)?.updatedSeq;
      push(server, "main", [
        command(3, "issueUpdate", rename(MAIN_ISSUE, "Main semantic title")),
        command(4, "issueUpdate", { id: PRIVATE_ISSUE, patch: { title: "Main legacy title", priority: 3 } }),
      ]);
      expect(server.store.get("issue", PRIVATE_ISSUE)!.updatedSeq).toBeGreaterThan(previousSemanticSeq!);
      const semanticSeq = server.store.get("issue", PRIVATE_ISSUE)?.updatedSeq;
      push(server, "legacy-remainder", [
        command(1, "issueUpdate", { id: PRIVATE_ISSUE, patch: { dueDate: "2026-12-01" } }),
      ]);
      expect(server.store.get("issue", PRIVATE_ISSUE)?.updatedSeq).toBe(semanticSeq);
      const preview = server.previewBranch(ALICE, branchId);
      expect(preview.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ issueId: MAIN_ISSUE, reason: "main_changed", mainTitle: "Main semantic title" }),
          expect.objectContaining({ issueId: PRIVATE_ISSUE, reason: "main_changed", mainTitle: "Main legacy title" }),
        ]),
      );
      expect(preview.conflicts).toHaveLength(2);
      const before = mainProjection(server);
      expect(
        server.mergeBranch(ALICE, {
          branchId,
          mergeId: id(311),
          expectedBranchHeadSeq: preview.branchHeadSeq,
          expectedMainSyncSeq: preview.mainSyncSeq,
        }),
      ).toMatchObject({ ok: false });
      expect(mainProjection(server)).toEqual(before);
      expect(server.getBranch(ALICE, branchId).status).toBe("open");
      push(server, "main", [command(5, "issueUpdate", rename(MAIN_ISSUE, "Main changed again"))]);
      expect(() =>
        server.mergeBranch(ALICE, {
          branchId,
          mergeId: id(312),
          expectedBranchHeadSeq: preview.branchHeadSeq,
          expectedMainSyncSeq: preview.mainSyncSeq,
          resolutions: [
            { issueId: MAIN_ISSUE, choice: "branch" },
            { issueId: PRIVATE_ISSUE, choice: "main" },
          ],
        }),
      ).toThrow(/preview|changed|stale/i);
      expect(server.store.get("issue", MAIN_ISSUE)?.title).toBe("Main changed again");
      const beforeBranchEdit = request(server, branchId, id(314));
      push(
        server,
        "proposal",
        [command(3, "issueUpdate", rename(MAIN_ISSUE, "Newer branch semantic title"))],
        branchId,
      );
      expect(server.currentSeq()).toBe(beforeBranchEdit.expectedMainSyncSeq);
      expect(() =>
        server.mergeBranch(ALICE, {
          ...beforeBranchEdit,
          resolutions: [
            { issueId: MAIN_ISSUE, choice: "branch" },
            { issueId: PRIVATE_ISSUE, choice: "main" },
          ],
        }),
      ).toThrow(/preview|changed|stale/i);
      const merged = server.mergeBranch(ALICE, {
        ...request(server, branchId, id(313)),
        resolutions: [
          { issueId: MAIN_ISSUE, choice: "branch" },
          { issueId: PRIVATE_ISSUE, choice: "main" },
        ],
      });
      expect(merged).toMatchObject({ ok: true, appliedEvents: 2, skippedEntities: 1 });
      expect(server.store.get("issue", MAIN_ISSUE)?.title).toBe("Newer branch semantic title");
      expect(server.store.get("issue", PRIVATE_ISSUE)).toMatchObject({ title: "Main legacy title", priority: 3 });
      expect(server.events(ALICE).filter((event) => event.type === "BranchConflictResolved")).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it("retains creation and supporting rows when an edited resolution changes its final title", () => {
    const { db, server } = fixture();
    try {
      const branchId = id(320);
      const proposedId = id(321);
      server.createBranch(ALICE, { id: branchId, name: "Edited creation" });
      push(
        server,
        "proposal",
        [
          command(1, "issueCreate", create(proposedId, id(322), "Original proposal")),
          command(2, "issueUpdate", rename(proposedId, "Final proposal")),
        ],
        branchId,
      );
      // A main creation followed by deletion still counts as an entity change since the fork.
      push(server, "main", [
        command(3, "issueCreate", create(proposedId, id(323), "Transient main issue")),
        command(4, "issueTrash", { id: proposedId, trashed: true }),
        command(5, "issueDelete", { id: proposedId }),
      ]);
      expect(server.previewBranch(ALICE, branchId).conflicts).toContainEqual(
        expect.objectContaining({ issueId: proposedId, reason: "main_changed" }),
      );
      const merged = server.mergeBranch(ALICE, {
        ...request(server, branchId, id(324)),
        resolutions: [{ issueId: proposedId, choice: "edit", title: "Human-reviewed title" }],
      });
      expect(merged.ok).toBe(true);
      expect(server.store.get("issue", proposedId)).toMatchObject({
        title: "Human-reviewed title",
        number: 3,
        creatorId: ALICE.id,
      });
      expect(server.store.list("issueSubscription", { issueId: proposedId })).toMatchObject([
        { id: id(322), userId: ALICE.id },
      ]);
      expect(server.events(ALICE, { entityId: proposedId }).filter((event) => event.type === "IssueCreated")).toEqual([
        expect.objectContaining({ seq: server.store.get("issue", proposedId)!.createdSeq }),
      ]);
    } finally {
      db.close();
    }
  });

  it("requires an active human owner and current permissions rather than branch-time privileges", () => {
    const { db, server } = fixture();
    try {
      const agent = { id: id(330), type: "agent" } as const;
      push(server, "agents", [command(1, "agentCreate", { id: agent.id, name: "Proposer", mode: "propose" })]);
      const branchId = id(331);
      server.createBranch(agent, { id: branchId, name: "Private proposal", scope: { teamIds: [PRIVATE_TEAM] } });
      push(
        server,
        "agent-proposal",
        [command(1, "issueUpdate", rename(PRIVATE_ISSUE, "Proposed private title"))],
        branchId,
        agent,
      );
      const input = request(server, branchId, id(332));
      expect(() => server.mergeBranch(agent, input)).toThrow(/human/i);
      expect(() => server.mergeBranch(BOB, input)).toThrow(/branch|owner|found/i);
      server.store.patch("teamMembership", id(41), { archivedAt: NOW });
      const before = mainProjection(server);
      const history = server.events(ALICE, { limit: 5000 });
      expectFailure(() => server.mergeBranch(ALICE, { ...input, expectedMainSyncSeq: server.currentSeq() }));
      expect(mainProjection(server)).toEqual(before);
      expect(server.events(ALICE, { limit: 5000 })).toEqual(history);
      expect(server.getBranch(ALICE, branchId).status).toBe("open");
      server.store.patch("user", ALICE.id, { active: false });
      expect(() => server.mergeBranch(ALICE, { ...input, expectedMainSyncSeq: server.currentSeq() })).toThrow(
        /active/i,
      );
    } finally {
      db.close();
    }
  });

  it("enforces branch scope against the current main issue during conflict resolution", () => {
    const { db, driver, server } = fixture();
    try {
      const branchId = id(380);
      server.createBranch(ALICE, { id: branchId, name: "Scoped proposal", scope: { teamIds: [TEAM] } });
      push(server, "proposal", [command(1, "issueUpdate", rename(MAIN_ISSUE, "Proposed scoped title"))], branchId);
      push(server, "main", [command(3, "issueUpdate", { id: MAIN_ISSUE, patch: { teamId: PRIVATE_TEAM } })]);
      expect(server.previewBranch(ALICE, branchId).conflicts).toContainEqual(
        expect.objectContaining({ issueId: MAIN_ISSUE, reason: "main_changed" }),
      );
      const before = mainProjection(server);
      const history = server.events(ALICE, { limit: 5000 });
      const cursor = server.currentSeq();
      const overlays = driver.all("SELECT * FROM branch_row WHERE branch_id = ? ORDER BY entity_type, entity_id", [
        branchId,
      ]);
      expect(() =>
        server.mergeBranch(ALICE, {
          ...request(server, branchId, id(381)),
          resolutions: [{ issueId: MAIN_ISSUE, choice: "branch" }],
        }),
      ).toThrow(/scope|team/i);
      expect(server.store.get("issue", MAIN_ISSUE)).toMatchObject({ teamId: PRIVATE_TEAM, title: "Live issue" });
      expect(mainProjection(server)).toEqual(before);
      expect(server.events(ALICE, { limit: 5000 })).toEqual(history);
      expect(server.currentSeq()).toBe(cursor);
      expect(server.getBranch(ALICE, branchId).status).toBe("open");
      expect(
        driver.all("SELECT * FROM branch_row WHERE branch_id = ? ORDER BY entity_type, entity_id", [branchId]),
      ).toEqual(overlays);
      expect(driver.all("SELECT COUNT(*) AS count FROM branch_merge WHERE branch_id = ?", [branchId])).toEqual([
        { count: 0 },
      ]);
    } finally {
      db.close();
    }
  });

  it.each(["trashed", "collision"] as const)("does not force a %s subject onto main", (kind) => {
    const { db, server } = fixture();
    try {
      const branchId = id(340);
      const subject = kind === "trashed" ? MAIN_ISSUE : id(341);
      server.createBranch(ALICE, { id: branchId, name: "Invalid force" });
      push(
        server,
        "proposal",
        [
          kind === "trashed"
            ? command(1, "issueUpdate", rename(subject, "Would resurrect"))
            : command(1, "issueCreate", create(subject, id(342), "Would overwrite")),
        ],
        branchId,
      );
      push(server, "main", [
        kind === "trashed"
          ? command(3, "issueTrash", { id: subject, trashed: true })
          : command(3, "issueCreate", create(subject, id(343), "Main collision")),
      ]);
      const preview = server.previewBranch(ALICE, branchId);
      expect(preview.conflicts).toContainEqual(
        expect.objectContaining({
          issueId: subject,
          reason: kind === "trashed" ? "issue_unavailable" : "issue_exists",
        }),
      );
      const before = mainProjection(server);
      const history = server.events(ALICE, { limit: 5000 });
      expectFailure(() =>
        server.mergeBranch(ALICE, {
          ...request(server, branchId, id(344)),
          resolutions: [{ issueId: subject, choice: "branch" }],
        }),
      );
      expect(mainProjection(server)).toEqual(before);
      expect(server.events(ALICE, { limit: 5000 })).toEqual(history);
      expect(server.getBranch(ALICE, branchId).status).toBe("open");
      expect(
        server.mergeBranch(ALICE, {
          ...request(server, branchId, id(345)),
          resolutions: [{ issueId: subject, choice: "main" }],
        }),
      ).toMatchObject({ ok: true, appliedEvents: 0, skippedEntities: 1 });
      expect(mainProjection(server)).toEqual(before);
    } finally {
      db.close();
    }
  });

  it("rolls back earlier main writes and branch closure after a late projection failure", () => {
    const { db, driver, server } = fixture();
    try {
      const branchId = id(350);
      server.createBranch(ALICE, { id: branchId, name: "Atomic merge" });
      push(
        server,
        "proposal",
        [
          command(1, "issueCreate", create(id(351), id(352), "Would succeed first")),
          command(2, "issueCreate", create(id(353), id(354), "Fails on subscription")),
        ],
        branchId,
      );
      push(server, "main", [command(3, "issueCreate", create(id(355), id(354), "Claims the subscription id"))]);
      const before = mainProjection(server);
      const history = server.events(ALICE, { limit: 5000 });
      const branchHistory = server.events(ALICE, { branchId });
      const overlays = driver.all("SELECT * FROM branch_row WHERE branch_id = ? ORDER BY entity_type, entity_id", [
        branchId,
      ]);
      const cursor = server.currentSeq();
      expect(server.previewBranch(ALICE, branchId).conflicts).toEqual([]);
      expectFailure(() => server.mergeBranch(ALICE, request(server, branchId, id(356))));
      expect(mainProjection(server)).toEqual(before);
      expect(server.events(ALICE, { limit: 5000 })).toEqual(history);
      expect(server.events(ALICE, { branchId })).toEqual(branchHistory);
      expect(server.currentSeq()).toBe(cursor);
      expect(server.getBranch(ALICE, branchId).status).toBe("open");
      expect(
        driver.all("SELECT * FROM branch_row WHERE branch_id = ? ORDER BY entity_type, entity_id", [branchId]),
      ).toEqual(overlays);
      expect(driver.all("SELECT COUNT(*) AS count FROM branch_merge WHERE branch_id = ?", [branchId])).toEqual([
        { count: 0 },
      ]);
    } finally {
      db.close();
    }
  });

  it("returns the same durable merge receipt after restart and rejects changed retries", () => {
    const directory = mkdtempSync(join(tmpdir(), "kanbun-merge-receipt-"));
    const database = join(directory, "workspace.sqlite");
    let opened = fixture(database);
    try {
      const branchId = id(360);
      opened.server.createBranch(ALICE, { id: branchId, name: "Durable result" });
      push(
        opened.server,
        "proposal",
        [
          command(1, "issueCreate", create(id(361), id(362))),
          command(2, "issueUpdate", rename(MAIN_ISSUE, "Merged title")),
        ],
        branchId,
      );
      const input = request(opened.server, branchId, id(363));
      const result = opened.server.mergeBranch(ALICE, input);
      expect(result).toMatchObject({ ok: true, appliedEvents: 2 });
      const before = mainProjection(opened.server);
      const history = opened.server.events(ALICE, { limit: 5000 });
      const cursor = opened.server.currentSeq();
      opened.db.close();
      const reopened = openWorkspaceDb(database);
      opened = { ...reopened, server: new SyncServer({ driver: reopened.driver, mutators, now: () => NOW }) };
      expect(opened.server.mergeBranch(ALICE, structuredClone(input))).toEqual(result);
      expect(opened.server.mergeBranch(ALICE, structuredClone(input))).toEqual(result);
      expect(opened.server.currentSeq()).toBe(cursor);
      expect(mainProjection(opened.server)).toEqual(before);
      expect(opened.server.events(ALICE, { limit: 5000 })).toEqual(history);
      expect(opened.server.store.get("team", TEAM)?.issueCounter).toBe(2);
      expect(() => opened.server.mergeBranch(ALICE, { ...input, mergeId: id(364) })).toThrow(/merge|different|closed/i);
      expect(() =>
        opened.server.mergeBranch(ALICE, { ...input, expectedMainSyncSeq: input.expectedMainSyncSeq + 1 }),
      ).toThrow(/merge|different|request/i);
      expect(() => opened.server.mergeBranch(BOB, input)).toThrow(/branch|owner|found/i);
      expect(() => opened.server.pull(ALICE, { clientId: "closed", branchId, since: 0 })).toThrow(
        /open|merged|closed/i,
      );
    } finally {
      opened.db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when an older branch has no reliable patch baseline", () => {
    const { db, driver, server } = fixture();
    try {
      const branchId = id(370);
      server.createBranch(ALICE, { id: branchId, name: "Historical branch" });
      push(server, "proposal", [command(1, "issueUpdate", rename(MAIN_ISSUE, "Old proposal"))], branchId);
      driver.run("UPDATE workspace_branch SET base_sync_seq = NULL WHERE id = ?", [branchId]);
      const before = mainProjection(server);
      expect(() => server.previewBranch(ALICE, branchId)).toThrow(/baseline|recreate/i);
      expect(() =>
        server.mergeBranch(ALICE, {
          branchId,
          mergeId: id(371),
          expectedBranchHeadSeq: 0,
          expectedMainSyncSeq: server.currentSeq(),
        }),
      ).toThrow(/baseline|recreate/i);
      expect(mainProjection(server)).toEqual(before);
      expect(server.getBranch(ALICE, branchId).status).toBe("open");
    } finally {
      db.close();
    }
  });
});
