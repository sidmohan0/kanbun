import { expect, it } from "vitest";
import type { PushResponse } from "@kanbun/sync";
import { startWorkspaceRuntime } from "./runtime";

it("persists attributed comments, rejects unauthorized changes, and pages only the visible issue's history", async () => {
  const runtime = await startWorkspaceRuntime();
  const id = (n: number) => `019a0000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
  try {
    const { issueId, teamId } = await runtime.seed();
    async function push(actor: string, mutationId: number, name: string, args: unknown) {
      const response = await runtime.fetch("/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Kanbun-Local-Actor": actor },
        body: JSON.stringify({
          clientId: `discussion-${actor}`,
          mutations: [{ id: mutationId, name, args, ts: "2026-10-30T00:00:00.000Z" }],
        }),
      });
      expect(response.status).toBe(200);
      return response.json() as Promise<PushResponse>;
    }
    expect(
      await push("bob", 1, "commentCreate", { id: id(1), issueId, body: "Bob's decision", subscriptionId: id(2) }),
    ).toMatchObject({ ok: true, rejected: [] });
    expect(
      await push("bob", 1, "commentCreate", { id: id(1), issueId, body: "Bob's decision", subscriptionId: id(2) }),
    ).toMatchObject({ ok: true, rejected: [] });
    expect(await push("alice", 1, "commentUpdate", { id: id(1), body: "Unauthorized" })).toMatchObject({
      ok: true,
      rejected: [{ id: 1 }],
    });
    expect(
      await push("alice", 2, "commentCreate", { id: id(3), issueId, body: "Reply", parentId: id(1) }),
    ).toMatchObject({ ok: true, rejected: [] });
    expect(await push("bob", 2, "commentUpdate", { id: id(1), body: "Updated decision" })).toMatchObject({
      ok: true,
      rejected: [],
    });
    expect(
      await push("alice", 3, "commentResolve", { id: id(1), resolved: true, resolvingCommentId: id(3) }),
    ).toMatchObject({ ok: true, rejected: [] });
    expect(
      await push("alice", 4, "issueCreate", { id: id(4), teamId, title: "Other issue", subscriptionId: id(5) }),
    ).toMatchObject({ ok: true, rejected: [] });
    expect(
      await push("alice", 5, "commentCreate", { id: id(6), issueId: id(4), body: "Other discussion" }),
    ).toMatchObject({ ok: true, rejected: [] });
    await runtime.restart();
    const loaded = await runtime.fetch(`/sync/load?model=comment&parentId=${issueId}`);
    expect(loaded.status).toBe(200);
    expect(await loaded.json()).toMatchObject({
      rows: [
        {
          id: id(1),
          body: "Updated decision",
          userId: "user-bob",
          resolvingUserId: "user-alice",
          resolvingCommentId: id(3),
        },
        { id: id(3), parentId: id(1), body: "Reply", userId: "user-alice" },
      ],
    });
    const newest = await runtime.fetch(`/sync/events?issueId=${issueId}&order=desc&limit=2`);
    expect(newest.status).toBe(200);
    const page = (await newest.json()) as {
      seq: number;
      type: string;
      actor: { id: string };
      payload: { issueId?: string };
    }[];
    expect(page.map((event) => event.type)).toEqual(["CommentResolved", "CommentEdited"]);
    expect(page[1]!.actor.id).toBe("user-bob");
    const older = await runtime.fetch(`/sync/events?issueId=${issueId}&order=desc&before=${page[1]!.seq}`);
    const history = (await older.json()) as typeof page;
    expect(history.filter((event) => event.type === "CommentPosted")).toHaveLength(2);
    expect(history.some((event) => event.payload.issueId === id(4))).toBe(false);
    await runtime.setTeamPrivate(teamId);
    for (const path of [`/sync/events?issueId=${issueId}`, `/sync/load?model=comment&parentId=${issueId}`]) {
      const response = await runtime.fetch(path, { headers: { "X-Kanbun-Local-Actor": "bob" } });
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain("decision");
    }
    expect(await push("bob", 3, "commentCreate", { id: id(7), issueId, body: "Forbidden" })).toMatchObject({
      ok: true,
      rejected: [{ id: 3 }],
    });
    expect(await push("alice", 6, "commentResolve", { id: id(1), resolved: false })).toMatchObject({
      ok: true,
      rejected: [],
    });
    const final = await runtime.inspect();
    expect(final.events.filter((event) => event.type === "CommentPosted")).toHaveLength(3);
  } finally {
    await runtime.close();
  }
});
