import { expect, it } from "vitest";
import { uuidv7 } from "@kanbun/model";
import type { BootstrapResponse, PullResponse, PushResponse } from "@kanbun/sync";
import { startWorkspaceRuntime } from "./runtime";

it("authorizes both relationship endpoints and revokes/restores cross-team pointers through actual HTTP and DO restart", async () => {
  const runtime = await startWorkspaceRuntime();
  try {
    const { teamId, issueId } = await runtime.seed();
    const otherTeam = uuidv7(),
      target = uuidv7(),
      replacement = uuidv7(),
      link = uuidv7();
    const ids = new Map<string, number>();
    async function push(name: string, args: unknown, actor = "alice") {
      const mutation = (ids.get(actor) ?? 0) + 1;
      ids.set(actor, mutation);
      const response = await runtime.fetch("/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Kanbun-Local-Actor": actor },
        body: JSON.stringify({
          clientId: `relationship-http-${actor}`,
          mutations: [{ id: mutation, name, args, ts: new Date().toISOString() }],
        }),
      });
      expect(response.status).toBe(200);
      return response.json() as Promise<PushResponse>;
    }
    expect(
      await push("teamCreate", {
        id: otherTeam,
        name: "Planning",
        key: "PLAN",
        membershipId: uuidv7(),
        stateIds: { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() },
      }),
    ).toMatchObject({ rejected: [] });
    expect(
      await push("issueCreate", {
        id: target,
        teamId: otherTeam,
        title: "Restricted planning task",
        subscriptionId: uuidv7(),
      }),
    ).toMatchObject({ rejected: [] });
    expect(await push("issueUpdate", { id: issueId, patch: { parentId: target } })).toMatchObject({ rejected: [] });
    expect(
      await push("issueRelationCreate", { id: link, issueId, relatedIssueId: target, type: "blocks" }),
    ).toMatchObject({ rejected: [] });
    expect(
      await push("issueCreate", { id: replacement, teamId, title: "Replacement parent", subscriptionId: uuidv7() }),
    ).toMatchObject({ rejected: [] });
    const bob = { "X-Kanbun-Local-Actor": "bob" };
    const bootstrap = async () =>
      (await (
        await runtime.fetch("/sync/bootstrap?clientId=relationship-bob-reader", { headers: bob })
      ).json()) as BootstrapResponse;
    expect((await bootstrap()).rows.issueRelation).toHaveLength(1);
    await runtime.setTeamPrivate(otherTeam);
    await runtime.restart();
    const hidden = await bootstrap();
    expect(hidden.rows.issue!.find((row) => row.id === issueId)).toMatchObject({ parentId: null });
    expect(hidden.rows.issueRelation).toHaveLength(0);
    for (const path of [
      "/sync/events",
      `/sync/events?issueId=${issueId}`,
      "/sync/activity",
      "/sync/activity?model=issueRelation",
    ]) {
      const response = await runtime.fetch(path, { headers: bob });
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain(target);
    }
    expect(await push("issueUpdate", { id: issueId, patch: { parentId: null } }, "bob")).toMatchObject({
      rejected: [],
    });
    expect(await push("issueUpdate", { id: issueId, patch: { parentId: target } })).toMatchObject({ rejected: [] });
    expect(await push("issueUpdate", { id: issueId, patch: { parentId: replacement } }, "bob")).toMatchObject({
      rejected: [],
    });
    expect(await push("issueUpdate", { id: issueId, patch: { parentId: target } })).toMatchObject({ rejected: [] });
    expect(await push("issueRelationDelete", { id: link }, "bob")).toMatchObject({ rejected: [{}] });
    expect(
      await push("issueRelationCreate", { id: uuidv7(), issueId, relatedIssueId: target, type: "related" }, "bob"),
    ).toMatchObject({ rejected: [{}] });
    expect(await push("issueUpdate", { id: issueId, patch: { parentId: target } }, "bob")).toMatchObject({
      rejected: [{}],
    });
    expect(await push("issueUpdate", { id: target, patch: { teamId } })).toMatchObject({ rejected: [] });
    const pull = async (since: number) =>
      (await (
        await runtime.fetch(`/sync/pull?clientId=relationship-bob-reader&since=${since}`, { headers: bob })
      ).json()) as PullResponse;
    const restored = await pull(hidden.seq);
    expect(restored).toMatchObject({ reset: false });
    expect(restored.entries).toContainEqual(
      expect.objectContaining({
        model: "issueRelation",
        id: link,
        op: "upsert",
        patch: expect.objectContaining({ relatedIssueId: target }),
      }),
    );
    expect(restored.entries).toContainEqual(
      expect.objectContaining({ model: "issue", id: issueId, patch: expect.objectContaining({ parentId: target }) }),
    );
    expect(await push("issueUpdate", { id: target, patch: { teamId: otherTeam } })).toMatchObject({ rejected: [] });
    const revoked = await pull(restored.seq);
    expect(revoked.entries).toContainEqual(
      expect.objectContaining({ model: "issueRelation", id: link, op: "delete", patch: null }),
    );
    expect(revoked.entries).toContainEqual(
      expect.objectContaining({ model: "issue", id: issueId, patch: expect.objectContaining({ parentId: null }) }),
    );
    expect(JSON.stringify((await bootstrap()).rows)).not.toContain(target);
    const owner = (await (
      await runtime.fetch("/sync/bootstrap?clientId=relationship-owner-reader")
    ).json()) as BootstrapResponse;
    expect(owner.rows.issueRelation).toHaveLength(1);
    expect(owner.rows.issue!.find((row) => row.id === issueId)).toMatchObject({ parentId: target });
  } finally {
    await runtime.close();
  }
});
