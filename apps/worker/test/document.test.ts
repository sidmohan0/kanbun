import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { issueIncarnation, type BootstrapResponse, type PushResponse } from "@kanbun/sync";
import { startWorkspaceRuntime } from "./runtime";

type Runtime = Awaited<ReturnType<typeof startWorkspaceRuntime>>;
type DocumentSnapshot = { update: string; mirror: string; contentState: string; incarnation: string };
let clientSequence = 0;
const encode = (doc: Y.Doc) => Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
const apply = (doc: Y.Doc, state: DocumentSnapshot) => Y.applyUpdate(doc, Buffer.from(state.update, "base64"));
async function incarnation(runtime: Runtime, issueId: string) {
  const issue = (await runtime.inspect()).issues.find((row) => row.id === issueId)!;
  return issueIncarnation(issue);
}
const issuePath = (issueId: string, version: string) =>
  `/sync/document?issueId=${issueId}&incarnation=${encodeURIComponent(version)}`;
async function read(runtime: Runtime, issueId: string) {
  const response = await runtime.fetch(issuePath(issueId, await incarnation(runtime, issueId)));
  expect(response.status).toBe(200);
  return response.json() as Promise<DocumentSnapshot>;
}
async function write(runtime: Runtime, issueId: string, update: string, actor = "alice", version?: string) {
  return runtime.fetch("/sync/document", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Kanbun-Local-Actor": actor,
    },
    body: JSON.stringify({ issueId, incarnation: version ?? (await incarnation(runtime, issueId)), update }),
  });
}
async function push(runtime: Runtime, name: string, args: unknown): Promise<PushResponse> {
  const response = await runtime.fetch("/sync/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientId: `document-test-${name}-${++clientSequence}`,
      mutations: [{ id: 1, name, args, ts: new Date().toISOString() }],
    }),
  });
  return response.json() as Promise<PushResponse>;
}

describe("SQLite DocumentDO descriptions", () => {
  it("merges independent edits, deduplicates retries, and retains the body across both object restarts", async () => {
    const runtime = await startWorkspaceRuntime();
    const left = new Y.Doc();
    const right = new Y.Doc();
    try {
      const { issueId } = await runtime.seed();
      const initial = await read(runtime, issueId);
      apply(left, initial);
      apply(right, initial);
      left.getText("description").insert(0, "Left ");
      right.getText("description").insert(0, "Right ");
      const responses = await Promise.all([
        write(runtime, issueId, encode(left)),
        write(runtime, issueId, encode(right), "bob"),
      ]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      const final = await read(runtime, issueId);
      expect(final.mirror).toContain("Left ");
      expect(final.mirror).toContain("Right ");
      expect(final.contentState).toMatch(/^[a-f0-9]{64}$/);
      const before = await runtime.inspect();
      const repeated = await write(runtime, issueId, encode(left));
      expect(repeated.status).toBe(200);
      expect((await runtime.inspect()).events).toEqual(before.events);
      await runtime.restartDocument(issueId);
      await runtime.restart();
      expect(await read(runtime, issueId)).toEqual(final);
      apply(left, final);
      left.getText("description").delete(0, left.getText("description").length);
      const deleted = await write(runtime, issueId, encode(left));
      const empty = (await deleted.json()) as DocumentSnapshot;
      expect(empty.mirror).toBe("");
      expect(empty.contentState).not.toBe(final.contentState);
      expect((await runtime.inspect()).issues.find((issue) => issue.id === issueId)?.description).toBe("");
    } finally {
      left.destroy();
      right.destroy();
      await runtime.close();
    }
  });

  it("recovers a durable body after mirror publication fails, keeping the original editor attribution", async () => {
    const runtime = await startWorkspaceRuntime();
    const doc = new Y.Doc();
    try {
      const { issueId } = await runtime.seed();
      apply(doc, await read(runtime, issueId));
      doc.getText("description").insert(0, "Durable before mirror");
      await runtime.failDocumentPublication(true);
      expect((await write(runtime, issueId, encode(doc), "bob")).status).toBe(500);
      expect((await runtime.inspect()).issues.find((issue) => issue.id === issueId)?.description).not.toBe(
        "Durable before mirror",
      );
      await runtime.failDocumentPublication(false);
      await runtime.restartDocument(issueId);
      await runtime.restart();
      expect((await read(runtime, issueId)).mirror).toBe("Durable before mirror");
      const events = (await (await runtime.fetch(`/sync/events?entityId=${issueId}`)).json()) as {
        type: string;
        actor: { id: string };
      }[];
      expect(events.filter((event) => event.type === "IssueDescribed").at(-1)?.actor.id).toBe("user-bob");
    } finally {
      doc.destroy();
      await runtime.close();
    }
  });

  it("rejects malformed state and forged mirrors without changing committed state", async () => {
    const runtime = await startWorkspaceRuntime();
    try {
      const { issueId } = await runtime.seed();
      const initial = await read(runtime, issueId);
      for (const invalid of ["not base64!", "AA==", "////"])
        expect((await write(runtime, issueId, invalid)).status).toBe(400);
      const unrelated = new Y.Doc();
      unrelated.getMap("unexpected").set("secret", "no");
      try {
        expect((await write(runtime, issueId, encode(unrelated))).status).toBe(400);
      } finally {
        unrelated.destroy();
      }
      expect(await read(runtime, issueId)).toEqual(initial);
      expect(
        await push(runtime, "issueDescribe", { id: issueId, description: "forged", contentState: "0".repeat(64) }),
      ).toMatchObject({ ok: true, rejected: [{ id: 1, error: expect.stringContaining("document endpoint") }] });
      expect(
        await push(runtime, "issueUpdate", { id: issueId, patch: { title: "Sneaky", description: "forged" } }),
      ).toMatchObject({ ok: true, rejected: [{ id: 1, error: expect.stringContaining("document endpoint") }] });
      const teamId = (await runtime.inspect()).issues.find((issue) => issue.id === issueId)!.teamId;
      expect(
        await push(runtime, "issueCreate", {
          id: "019a0000-0000-7000-8000-000000009010",
          teamId,
          title: "Foreign body reference",
          subscriptionId: "019a0000-0000-7000-8000-000000009011",
          descriptionContentId: issueId,
        }),
      ).toMatchObject({ ok: true, rejected: [{ id: 1, error: expect.stringContaining("belong to this issue") }] });
      expect(
        (await runtime.fetch(`${issuePath(issueId, await incarnation(runtime, issueId))}&branchId=main`)).status,
      ).toBe(400);
      expect((await runtime.fetch("/sync/document", { method: "DELETE" })).status).toBe(405);
    } finally {
      await runtime.close();
    }
  });

  it("publishes an interrupted editor's durable state before accepting the next person's changes", async () => {
    const runtime = await startWorkspaceRuntime();
    const bob = new Y.Doc();
    const alice = new Y.Doc();
    try {
      const { issueId } = await runtime.seed();
      const initial = await read(runtime, issueId);
      apply(bob, initial);
      apply(alice, initial);
      bob.getText("description").insert(0, "Bob's durable edit ");
      alice.getText("description").insert(0, "Alice's following edit ");
      await runtime.failDocumentPublication(true);
      expect((await write(runtime, issueId, encode(bob), "bob")).status).toBe(500);
      await runtime.failDocumentPublication(false);
      expect((await write(runtime, issueId, encode(alice))).status).toBe(200);
      const final = await read(runtime, issueId);
      expect(final.mirror).toContain("Bob's durable edit");
      expect(final.mirror).toContain("Alice's following edit");
      const events = (await (await runtime.fetch(`/sync/events?entityId=${issueId}`)).json()) as {
        type: string;
        actor: { id: string };
      }[];
      expect(
        events
          .filter((event) => event.type === "IssueDescribed")
          .slice(-2)
          .map((event) => event.actor.id),
      ).toEqual(["user-bob", "user-alice"]);
      const count = events.length;
      expect((await write(runtime, issueId, encode(bob), "bob")).status).toBe(200);
      expect((await (await runtime.fetch(`/sync/events?entityId=${issueId}`)).json()) as unknown[]).toHaveLength(count);
    } finally {
      bob.destroy();
      alice.destroy();
      await runtime.close();
    }
  });

  it("isolates a recreated issue UUID from its deleted private body and rejects stale description requests", async () => {
    const runtime = await startWorkspaceRuntime();
    const doc = new Y.Doc();
    try {
      const { issueId, teamId } = await runtime.seed();
      await runtime.setTeamPrivate(teamId);
      const initial = await read(runtime, issueId);
      apply(doc, initial);
      doc.getText("description").insert(0, "Old private body");
      expect((await write(runtime, issueId, encode(doc))).status).toBe(200);
      expect(await push(runtime, "issueTrash", { id: issueId, trashed: true })).toMatchObject({
        ok: true,
        rejected: [],
      });
      expect(await push(runtime, "issueDelete", { id: issueId })).toMatchObject({ ok: true, rejected: [] });
      expect(await push(runtime, "teamUpdate", { id: teamId, patch: { visibility: "public" } })).toMatchObject({
        ok: true,
        rejected: [],
      });
      expect(
        await push(runtime, "issueCreate", {
          id: issueId,
          teamId,
          title: "A different public issue",
          subscriptionId: "019a0000-0000-7000-8000-000000009009",
        }),
      ).toMatchObject({ ok: true, rejected: [] });
      expect((await runtime.fetch(issuePath(issueId, initial.incarnation))).status).toBe(409);
      expect((await write(runtime, issueId, encode(doc), "alice", initial.incarnation)).status).toBe(409);
      const current = await read(runtime, issueId);
      expect(current.incarnation).not.toBe(initial.incarnation);
      expect(current.mirror).toBe("");
      const bob = await runtime.fetch(issuePath(issueId, current.incarnation), {
        headers: { "X-Kanbun-Local-Actor": "bob" },
      });
      expect(bob.status).toBe(200);
      expect(await bob.text()).not.toContain("Old private body");
    } finally {
      doc.destroy();
      await runtime.close();
    }
  });

  it("keeps private-team document metadata out of bootstrap, pull, event history and direct access", async () => {
    const runtime = await startWorkspaceRuntime();
    const doc = new Y.Doc();
    try {
      const { issueId, teamId } = await runtime.seed();
      await runtime.setTeamPrivate(teamId);
      apply(doc, await read(runtime, issueId));
      doc.getText("description").insert(0, "Private body");
      expect((await write(runtime, issueId, encode(doc))).status).toBe(200);
      const headers = { "X-Kanbun-Local-Actor": "bob" };
      expect((await runtime.fetch(issuePath(issueId, await incarnation(runtime, issueId)), { headers })).status).toBe(
        403,
      );
      expect((await write(runtime, issueId, encode(doc), "bob")).status).toBe(403);
      const bootstrap = (await (
        await runtime.fetch("/sync/bootstrap?clientId=private-document-reader", { headers })
      ).json()) as BootstrapResponse;
      expect(bootstrap.rows.documentContent ?? []).toEqual([]);
      const pulled = await (
        await runtime.fetch("/sync/pull?clientId=private-document-reader&since=0", { headers })
      ).text();
      expect(pulled).not.toContain("Private body");
      expect(pulled).not.toContain(issueId);
      const history = await (await runtime.fetch(`/sync/events?entityId=${issueId}`, { headers })).text();
      expect(history).not.toContain("Private body");
      expect((await runtime.fetch(`/sync/load?model=documentContent&parentId=${issueId}`, { headers })).status).toBe(
        400,
      );
      const currentVersion = await incarnation(runtime, issueId);
      await runtime.setMemberActive("alice", false);
      expect((await runtime.fetch(issuePath(issueId, currentVersion))).status).toBe(403);
      doc.getText("description").insert(0, "Revoked write ");
      expect((await write(runtime, issueId, encode(doc), "alice", currentVersion)).status).toBe(403);
      await runtime.setMemberActive("alice", true);
      expect((await read(runtime, issueId)).mirror).toBe("Private body");
    } finally {
      doc.destroy();
      await runtime.close();
    }
  });
});
