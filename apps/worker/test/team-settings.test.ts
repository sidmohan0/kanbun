import { expect, it } from "vitest";
import { uuidv7 } from "@kanbun/model";
import type { PushResponse } from "@kanbun/sync";
import { startPreviewRuntime } from "./preview-runtime";

const post = (value: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});

it("persists owner-managed teams and status order, rejects forged member administration and stale reorder", async () => {
  const runtime = await startPreviewRuntime();
  try {
    await runtime.context();
    const memberToken = await runtime.token({ sub: "settings-member", email: "member@example.com" });
    const invitation = (await (
      await runtime.fetch("/api/invitations", post({ email: "member@example.com" }))
    ).json()) as { token: string };
    expect(
      (await runtime.fetch("/api/invitations/accept", post({ token: invitation.token }), memberToken)).status,
    ).toBe(200);
    async function push(name: string, args: unknown, token?: string) {
      const response = await runtime.fetch(
        "/sync/push",
        post({ clientId: `settings-${uuidv7()}`, mutations: [{ id: 1, name, args, ts: new Date().toISOString() }] }),
        token,
      );
      expect(response.status).toBe(200);
      return response.json() as Promise<PushResponse>;
    }
    const teamId = uuidv7();
    const stateIds = { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() };
    const create = { id: teamId, name: "Engineering", key: "ENG", membershipId: uuidv7(), stateIds };
    expect(await push("teamCreate", create, memberToken)).toMatchObject({ ok: true, rejected: [{ id: 1 }] });
    expect(await push("teamCreate", create)).toMatchObject({ ok: true, rejected: [] });
    expect(await push("teamCreate", { ...create, id: uuidv7(), membershipId: uuidv7() })).toMatchObject({
      ok: true,
      rejected: [{ id: 1 }],
    });
    const review = uuidv7();
    expect(
      await push("workflowStateCreate", { id: review, teamId, name: "Review", type: "started", color: "#F2C94C" }),
    ).toMatchObject({ ok: true, rejected: [] });
    for (const [name, args] of [
      ["teamUpdate", { id: teamId, patch: { name: "Forged team" } }],
      ["workflowStateCreate", { id: uuidv7(), teamId, name: "Forged state", type: "started", color: "#F2C94C" }],
      ["workflowStateUpdate", { id: review, patch: { name: "Forged review" } }],
      ["workflowStateReorder", { teamId, type: "started", stateIds: [review, stateIds.inProgress] }],
      ["workspaceNameSync", { id: runtime.workspaceId, name: "Forged workspace" }],
    ] as const)
      expect(await push(name, args, memberToken)).toMatchObject({ ok: true, rejected: [{ id: 1 }] });
    expect(await push("workflowStateReorder", { teamId, type: "started", stateIds: [review] })).toMatchObject({
      ok: true,
      rejected: [{ id: 1 }],
    });
    expect(await push("workflowStateReorder", { teamId, type: "started", stateIds: [review, review] })).toMatchObject({
      ok: true,
      rejected: [{ id: 1 }],
    });
    expect(
      await push("workflowStateReorder", { teamId, type: "started", stateIds: [stateIds.backlog, review] }),
    ).toMatchObject({ ok: true, rejected: [{ id: 1 }] });
    expect(
      await push("workflowStateReorder", { teamId, type: "started", stateIds: [review, stateIds.inProgress] }),
    ).toMatchObject({ ok: true, rejected: [] });
    expect(await push("workflowStateUpdate", { id: stateIds.inProgress, patch: { name: "Doing" } })).toMatchObject({
      ok: true,
      rejected: [],
    });
    expect(
      await push("teamUpdate", { id: teamId, patch: { name: "Platform", defaultIssueStateId: review } }),
    ).toMatchObject({ ok: true, rejected: [] });
    const issueId = uuidv7();
    expect(
      await push("issueCreate", { id: issueId, teamId, title: "Use new defaults", subscriptionId: uuidv7() }),
    ).toMatchObject({ ok: true, rejected: [] });
    await runtime.restart();
    const saved = await runtime.inspect();
    expect(saved.rows.team!.find((team) => team.id === teamId)).toMatchObject({
      name: "Platform",
      key: "ENG",
      defaultIssueStateId: review,
    });
    expect(saved.rows.workflowState!.filter((state) => state.teamId === teamId)).toHaveLength(6);
    expect(saved.rows.workflowState!.find((state) => state.id === review)).toMatchObject({ position: 0 });
    expect(saved.rows.workflowState!.find((state) => state.id === stateIds.inProgress)).toMatchObject({
      name: "Doing",
      position: 1,
    });
    expect(saved.rows.issue!.find((issue) => issue.id === issueId)).toMatchObject({
      stateId: review,
      derivedStateId: review,
      number: 1,
    });
  } finally {
    await runtime.close();
  }
});

it("renames the canonical workspace without changing its identity and repairs an interrupted directory projection", async () => {
  const runtime = await startPreviewRuntime();
  try {
    const before = await runtime.context();
    const original = await runtime.inspect();
    const memberToken = await runtime.token({ sub: "rename-member", email: "member@example.com" });
    const invitation = (await (
      await runtime.fetch("/api/invitations", post({ email: "member@example.com" }))
    ).json()) as { token: string };
    expect(
      (await runtime.fetch("/api/invitations/accept", post({ token: invitation.token }), memberToken)).status,
    ).toBe(200);
    expect((await runtime.fetch("/api/workspace/name", post({ name: "Forbidden" }), memberToken)).status).toBe(403);
    expect((await runtime.fetch("/api/workspace/name", post({ name: "   " }))).status).toBe(400);
    expect((await runtime.fetch("/api/workspace/name", post({ name: "DataFog", workspaceId: uuidv7() }))).status).toBe(
      400,
    );
    const renamed = await runtime.fetch("/api/workspace/name", post({ name: " DataFog " }));
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({
      workspaceId: before.workspaceId,
      workspaceName: "DataFog",
      actor: before.actor,
    });
    await runtime.restart();
    expect(await runtime.context(memberToken)).toMatchObject({
      workspaceName: "DataFog",
      workspaceId: before.workspaceId,
    });
    expect((await runtime.inspect()).rows.organization![0]).toMatchObject({ id: before.workspaceId, name: "DataFog" });
    expect(await runtime.directoryWorkspace()).toMatchObject({ id: before.workspaceId, name: "DataFog" });
    await runtime.failWorkspaceNameProjection(true);
    expect((await runtime.fetch("/api/workspace/name", post({ name: "DataFog Team" }))).status).toBe(500);
    expect(await runtime.directoryWorkspace()).toMatchObject({ name: "DataFog Team" });
    await runtime.failWorkspaceNameProjection(false);
    await runtime.restart();
    expect(await runtime.context()).toMatchObject({ workspaceName: "DataFog Team", workspaceId: before.workspaceId });
    const saved = await runtime.inspect();
    expect(saved.rows.organization![0]).toMatchObject({ id: before.workspaceId, name: "DataFog Team" });
    expect(saved.rows.team).toEqual(original.rows.team);
    expect(saved.rows.issue).toEqual(original.rows.issue);
    expect(saved.rows.workflowState).toEqual(original.rows.workflowState);
  } finally {
    await runtime.close();
  }
});
