import { expect, it } from "vitest";
import { uuidv7 } from "@kanbun/model";
import { issueIncarnation, type Actor } from "@kanbun/sync";
import { SyncServer } from "@kanbun/sync/server";
import { openWorkspaceDb } from "@kanbun/sync/server/node";
import { mutators } from "../src";

const now = "2026-11-02T00:00:00.000Z";
const actor: Actor = { id: "owner", type: "user" };
function fixture() {
  const database = openWorkspaceDb();
  const server = new SyncServer({ driver: database.driver, mutators, now: () => now });
  server.system("workspaceInit", {
    organization: { id: uuidv7(), name: "Workspace", urlKey: "workspace" },
    owner: { id: actor.id, name: "Owner", email: "owner@example.com" },
  });
  const push = (name: string, args: unknown, person = actor) =>
    server.push(person, { clientId: uuidv7(), mutations: [{ id: 1, name, args, ts: now }] });
  const teamId = uuidv7(),
    issueId = uuidv7();
  const stateIds = { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() };
  expect(
    push("teamCreate", { id: teamId, name: "Engineering", key: "ENG", membershipId: uuidv7(), stateIds }),
  ).toMatchObject({ rejected: [] });
  expect(push("issueCreate", { id: issueId, teamId, title: "Implement", subscriptionId: uuidv7() })).toMatchObject({
    rejected: [],
  });
  const copy = () =>
    push("issueBranchNameCopied", {
      id: issueId,
      teamId,
      issueIncarnation: issueIncarnation(server.store.get("issue", issueId)!),
      assigneeSubscriptionId: uuidv7(),
    });
  const preferences = (patch: object) => expect(push("userSettingsUpdate", { patch })).toMatchObject({ rejected: [] });
  return { ...database, server, push, teamId, issueId, stateIds, copy, preferences };
}

it("defaults off, starts atomically with optional assignment, and repeated copies do not reassert status", () => {
  const f = fixture();
  try {
    const before = f.server.store.get("issue", f.issueId)!;
    expect(f.copy()).toMatchObject({ rejected: [] });
    expect(f.server.store.get("issue", f.issueId)).toEqual(before);
    f.preferences({ moveIssueToStartOnBranchCopy: true, autoAssignToSelf: true });
    expect(f.copy()).toMatchObject({ rejected: [] });
    expect(f.server.store.get("issue", f.issueId)).toMatchObject({
      stateId: f.stateIds.inProgress,
      assigneeId: actor.id,
      startedAt: now,
    });
    const started = f.server.store.get("issue", f.issueId)!;
    expect(f.copy()).toMatchObject({ rejected: [] });
    expect(f.server.store.get("issue", f.issueId)).toEqual(started);
  } finally {
    f.db.close();
  }
});

it("preserves terminal work, another assignee, and stale issue identity or team", () => {
  const f = fixture();
  try {
    f.preferences({ moveIssueToStartOnBranchCopy: true, autoAssignToSelf: true });
    f.server.system("memberSync", { id: "other", name: "Other", email: "other@example.com" });
    expect(f.push("issueUpdate", { id: f.issueId, patch: { assigneeId: "other" } })).toMatchObject({ rejected: [] });
    expect(f.copy()).toMatchObject({ rejected: [] });
    expect(f.server.store.get("issue", f.issueId)!.assigneeId).toBe("other");
    for (const stateId of [f.stateIds.done, f.stateIds.canceled]) {
      expect(f.push("issueAssertStatus", { id: f.issueId, stateId })).toMatchObject({ rejected: [] });
      const before = f.server.store.get("issue", f.issueId)!;
      expect(f.copy()).toMatchObject({ rejected: [] });
      expect(f.server.store.get("issue", f.issueId)).toEqual(before);
    }
    expect(f.push("issueAssertStatus", { id: f.issueId, stateId: f.stateIds.todo })).toMatchObject({ rejected: [] });
    for (const overrides of [{ issueIncarnation: "previous" }, { teamId: uuidv7() }]) {
      expect(
        f.push("issueBranchNameCopied", {
          id: f.issueId,
          teamId: f.teamId,
          issueIncarnation: issueIncarnation(f.server.store.get("issue", f.issueId)!),
          assigneeSubscriptionId: uuidv7(),
          ...overrides,
        }),
      ).toMatchObject({ rejected: [] });
      expect(f.server.store.get("issue", f.issueId)!.stateId).toBe(f.stateIds.todo);
    }
  } finally {
    f.db.close();
  }
});

it("rejects agent access and missing Started status without partially assigning", () => {
  const f = fixture();
  try {
    f.preferences({ moveIssueToStartOnBranchCopy: true, autoAssignToSelf: true });
    const args = {
      id: f.issueId,
      teamId: f.teamId,
      issueIncarnation: issueIncarnation(f.server.store.get("issue", f.issueId)!),
      assigneeSubscriptionId: uuidv7(),
    };
    expect(() =>
      mutators.issueBranchNameCopied.decide(
        { store: f.server.store, actor: { ...actor, type: "agent" }, actorId: actor.id, now, server: true },
        args,
      ),
    ).toThrow("Only people can copy branch names");
    f.server.store.patch("workflowState", f.stateIds.inProgress, { archivedAt: now });
    expect(f.copy()).toMatchObject({
      rejected: [{ error: "This team has no Started workflow status. Add one in Settings." }],
    });
    expect(f.server.store.get("issue", f.issueId)).toMatchObject({ assigneeId: null });
  } finally {
    f.db.close();
  }
});

it("keeps archived work unchanged and checks current preferences and triage priority on replay", () => {
  const f = fixture();
  try {
    f.preferences({ moveIssueToStartOnBranchCopy: true, autoAssignToSelf: true });
    f.server.store.patch("issue", f.issueId, { archivedAt: now });
    const archived = f.server.store.get("issue", f.issueId)!;
    expect(f.copy()).toMatchObject({ rejected: [] });
    expect(f.server.store.get("issue", f.issueId)).toEqual(archived);
    f.server.store.patch("issue", f.issueId, { archivedAt: null });
    f.preferences({ moveIssueToStartOnBranchCopy: false });
    expect(f.copy()).toMatchObject({ rejected: [] });
    expect(f.server.store.get("issue", f.issueId)!.stateId).not.toBe(f.stateIds.inProgress);
    const triageId = uuidv7();
    expect(
      f.push("workflowStateCreate", {
        id: triageId,
        teamId: f.teamId,
        name: "Triage",
        type: "triage",
        color: "#ffffff",
      }),
    ).toMatchObject({ rejected: [] });
    expect(f.push("issueAssertStatus", { id: f.issueId, stateId: triageId })).toMatchObject({ rejected: [] });
    f.server.store.patch("team", f.teamId, { requirePriorityToLeaveTriage: true });
    f.preferences({ moveIssueToStartOnBranchCopy: true });
    expect(f.copy()).toMatchObject({ rejected: [{ error: "set a priority before leaving triage" }] });
    expect(f.server.store.get("issue", f.issueId)).toMatchObject({ stateId: triageId, assigneeId: null });
  } finally {
    f.db.close();
  }
});
