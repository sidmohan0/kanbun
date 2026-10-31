import { describe, expect, it } from "vitest";
import { uuidv7 } from "@kanbun/model";
import { issueIncarnation, type WorkspaceContext } from "@kanbun/sync";
import * as Y from "yjs";
import { createHash } from "node:crypto";
import type { BodyBackup } from "../src/backup-format";
import { startPreviewRuntime } from "./preview-runtime";

type Runtime = Awaited<ReturnType<typeof startPreviewRuntime>>;
const post = (value: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});
const manifests = async (runtime: Runtime) =>
  (await runtime.backupKeys()).filter((key) => key.endsWith("/manifest.json"));
async function initialBackup(runtime: Runtime) {
  await runtime.context();
  await expect.poll(async () => (await manifests(runtime)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect
    .poll(
      async () =>
        (await runtime.backupTables())["scheduled_job"]?.some(
          (job) =>
            typeof job["payload"] === "string" &&
            Boolean((JSON.parse(job["payload"]) as { manifestKey?: string }).manifestKey),
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}
async function createIssue(runtime: Runtime) {
  const context = await runtime.context();
  const initial = await runtime.inspect();
  const teamId = String(initial.rows.team![0]!["id"]),
    issueId = uuidv7();
  const creation = {
    id: 1,
    name: "issueCreate",
    args: { id: issueId, teamId, title: "Recovered issue", subscriptionId: uuidv7() },
    ts: new Date().toISOString(),
  };
  expect(
    await (await runtime.fetch("/sync/push", post({ clientId: "backup-source-client", mutations: [creation] }))).json(),
  ).toMatchObject({ ok: true, rejected: [] });
  const row = (await runtime.inspect()).rows.issue!.find((issue) => issue["id"] === issueId)!;
  const incarnation = issueIncarnation({ createdSeq: Number(row["createdSeq"]), createdAt: String(row["createdAt"]) });
  return { context, teamId, issueId, incarnation };
}
async function writeBody(runtime: Runtime, issueId: string, incarnation: string, text: string) {
  const query = new URLSearchParams({ issueId, incarnation });
  const response = await runtime.fetch(`/sync/document?${query}`);
  expect(response.status).toBe(200);
  const initial = (await response.json()) as { update: string };
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, Uint8Array.from(Buffer.from(initial.update, "base64")));
    const body = doc.getText("description");
    body.delete(0, body.length);
    body.insert(0, text);
    return runtime.fetch(
      "/sync/document",
      post({ issueId, incarnation, update: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64") }),
    );
  } finally {
    doc.destroy();
  }
}

describe("private coherent workspace backups in workerd", () => {
  it("restores full SQL, D1 identities, branches, retry cursors and Yjs bodies in a fresh isolated runtime", async () => {
    const source = await startPreviewRuntime({ backups: true });
    const target = await startPreviewRuntime({ backups: true, isolatedRestore: true });
    try {
      await initialBackup(source);
      const { context, teamId, issueId, incarnation } = await createIssue(source);
      const memberIdentity = {
        sub: "backup-member-subject",
        email: "backup-member@example.com",
        name: "Backup member",
      };
      const invitationResponse = await source.fetch("/api/invitations", post({ email: memberIdentity.email }));
      expect(invitationResponse.status).toBe(200);
      const invitation = (await invitationResponse.json()) as { token: string };
      const accepted = await source.fetch(
        "/api/invitations/accept",
        post({ token: invitation.token }),
        await source.token(memberIdentity),
      );
      expect(accepted.status).toBe(200);
      const memberContext = (await accepted.json()) as WorkspaceContext;
      const commentId = uuidv7(),
        replyId = uuidv7();
      const commentBody = "Keep this attributed recovery decision. 日本語";
      const replyBody = "The invited member confirms the recovery plan.";
      expect(
        await (
          await source.fetch(
            "/sync/push",
            post({
              clientId: "backup-discussion-owner",
              mutations: [
                {
                  id: 1,
                  name: "commentCreate",
                  args: { id: commentId, issueId, body: commentBody },
                  ts: new Date().toISOString(),
                },
              ],
            }),
          )
        ).json(),
      ).toMatchObject({ ok: true, rejected: [] });
      expect(
        await (
          await source.fetch(
            "/sync/push",
            post({
              clientId: "backup-discussion-member",
              mutations: [
                {
                  id: 1,
                  name: "commentCreate",
                  args: { id: replyId, issueId, parentId: commentId, body: replyBody },
                  ts: new Date().toISOString(),
                },
              ],
            }),
            await source.token(memberIdentity),
          )
        ).json(),
      ).toMatchObject({ ok: true, rejected: [] });
      expect(
        await (
          await source.fetch(
            "/sync/push",
            post({
              clientId: "backup-discussion-owner",
              mutations: [
                {
                  id: 2,
                  name: "commentResolve",
                  args: { id: commentId, resolved: true, resolvingCommentId: replyId },
                  ts: new Date().toISOString(),
                },
              ],
            }),
          )
        ).json(),
      ).toMatchObject({ ok: true, rejected: [] });
      const description = "Recover the shared Yjs body and its exact workspace mirror. 日本語";
      expect((await writeBody(source, issueId, incarnation, description)).status).toBe(200);
      const branchId = uuidv7();
      expect(
        (
          await source.fetch(
            "/sync/branch/create",
            post({ id: branchId, name: "Recovery proposal", scope: { teamIds: [teamId] } }),
          )
        ).status,
      ).toBe(200);
      const branchWrite = {
        clientId: "backup-branch-client",
        branchId,
        mutations: [
          {
            id: 1,
            name: "issueUpdate",
            args: { id: issueId, patch: { title: "A preserved branch proposal" } },
            ts: new Date().toISOString(),
          },
        ],
      };
      expect(await (await source.fetch("/sync/push", post(branchWrite))).json()).toMatchObject({
        ok: true,
        rejected: [],
      });
      const rename = {
        clientId: "backup-source-client",
        mutations: [
          {
            id: 2,
            name: "issueUpdate",
            args: { id: issueId, patch: { title: "The main title at the backup point" } },
            ts: new Date().toISOString(),
          },
        ],
      };
      expect(await (await source.fetch("/sync/push", post(rename))).json()).toMatchObject({ ok: true, rejected: [] });
      await expect.poll(async () => (await source.notificationProgress()).settled).toBe(true);
      const receipt = await source.backup();
      const objects = await source.exportBackup(receipt.key);
      const audit = (await source.inspect()).events.find(
        (event) =>
          event["type"] === "SnapshotTaken" &&
          (JSON.parse(String(event["payload"])) as { snapshotId: string }).snapshotId === receipt.key,
      )!;
      expect(audit).toMatchObject({ entity_id: source.workspaceId });
      expect(JSON.parse(String(audit["actor"]))).toEqual({ id: "system", type: "system" });
      expect(JSON.parse(String(audit["payload"]))).toEqual({
        snapshotId: receipt.key,
        sourceSeq: receipt.eventSeq,
        contentHash: createHash("sha256")
          .update(objects.find((object) => object.key === receipt.key)!.data)
          .digest("hex"),
      });
      expect(Number(audit["seq"])).toBeGreaterThan(receipt.eventSeq);
      const visibleFacts = await source.fetch("/sync/events");
      expect(visibleFacts.status).toBe(200);
      expect(await visibleFacts.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "SnapshotTaken",
            entityId: source.workspaceId,
            actor: { id: "system", type: "system" },
            payload: expect.objectContaining({ snapshotId: receipt.key, sourceSeq: receipt.eventSeq }),
          }),
        ]),
      );
      expect((await source.backupTables())["sync_log"]!.some((row) => row["event_seq"] === audit["seq"])).toBe(false);
      await target.importBackup(objects);
      expect((await target.fetch("/api/context", {}, null)).status).toBe(401);
      expect((await target.fetch("/api/context")).status).toBe(503);
      expect((await target.fetch("/api/members")).status).toBe(503);
      expect(
        (
          await target.fetch(
            "/api/invitations/accept",
            post({ token: invitation.token }),
            await target.token(memberIdentity),
          )
        ).status,
      ).toBe(503);
      expect(await target.directoryCounts()).toEqual({ accounts: 0, workspaces: 0, members: 0 });
      expect(await target.restoreBackup(receipt.key)).toMatchObject({
        key: receipt.key,
        mainSeq: receipt.mainSeq,
        eventSeq: receipt.eventSeq,
      });
      const archived = JSON.parse(objects.find((object) => object.key.endsWith("/workspace.json"))!.data) as {
        tables: { name: string; columns: string[]; rows: unknown[][] }[];
      };
      const restoredTables = await target.backupTables();
      expect(Object.keys(restoredTables).sort()).toEqual(archived.tables.map((table) => table.name).sort());
      for (const table of archived.tables) {
        const rows = restoredTables[table.name]!.map((row) => table.columns.map((column) => row[column]));
        expect(
          rows.sort((a, b) =>
            JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0,
          ),
        ).toEqual(table.rows);
      }
      expect(await target.context()).toMatchObject({ actor: context.actor, workspaceId: source.workspaceId });
      expect(await target.context(await target.token(memberIdentity))).toEqual(memberContext);
      expect((await target.fetch("/api/members", {}, await target.token(memberIdentity))).status).toBe(403);
      expect(
        (await target.fetch("/api/context", {}, await target.token({ ...memberIdentity, sub: "wrong-subject" })))
          .status,
      ).toBe(403);
      const body = await target.fetch(`/sync/document?${new URLSearchParams({ issueId, incarnation })}`);
      const archivedBodies = JSON.parse(objects.find((object) => object.key.endsWith("/documents.json"))!.data) as {
        issueId: string;
        state: { update: string; contentState: string };
      }[];
      const archivedBody = archivedBodies.find((entry) => entry.issueId === issueId)!.state;
      expect(await body.json()).toMatchObject({
        mirror: description,
        incarnation,
        update: archivedBody.update,
        contentState: archivedBody.contentState,
      });
      const restoredDiscussion = await target.fetch(`/sync/load?model=comment&parentId=${issueId}`);
      expect(restoredDiscussion.status).toBe(200);
      expect(await restoredDiscussion.json()).toMatchObject({
        rows: expect.arrayContaining([
          expect.objectContaining({
            id: commentId,
            issueId,
            body: commentBody,
            userId: context.actor.id,
            parentId: null,
            resolvingUserId: context.actor.id,
            resolvingCommentId: replyId,
          }),
          expect.objectContaining({
            id: replyId,
            issueId,
            body: replyBody,
            userId: memberContext.actor.id,
            parentId: commentId,
          }),
        ]),
      });
      const branch = await target.fetch(
        `/sync/bootstrap?${new URLSearchParams({ clientId: "backup-branch-client", branchId })}`,
      );
      expect(((await branch.json()) as { rows: { issue: { title: string }[] } }).rows.issue).toEqual(
        expect.arrayContaining([expect.objectContaining({ title: "A preserved branch proposal" })]),
      );
      const beforeRetry = await target.inspect();
      expect(await (await target.fetch("/sync/push", post(rename))).json()).toMatchObject({
        ok: true,
        lastMutationId: 2,
        rejected: [],
      });
      expect((await target.inspect()).events).toEqual(beforeRetry.events);
      expect((await target.inspect()).rows.issue!.find((issue) => issue["id"] === issueId)?.["title"]).toBe(
        "The main title at the backup point",
      );
      await expect(target.restoreBackup(receipt.key)).rejects.toThrow(/already been used/);
      await expect(source.restoreBackup(receipt.key)).rejects.toThrow(/not enabled/);
      expect((await source.fetch("/sync/restore", post({ key: receipt.key }))).status).toBe(404);
    } finally {
      await target.close();
      await source.close();
    }
  }, 30_000);

  it("rejects corrupted archives and nonempty target namespaces before importing user data", async () => {
    const source = await startPreviewRuntime({ backups: true });
    const target = await startPreviewRuntime({ backups: true, isolatedRestore: true });
    const used = await startPreviewRuntime({ backups: true, isolatedRestore: true });
    try {
      await initialBackup(source);
      const { issueId, incarnation } = await createIssue(source);
      expect((await writeBody(source, issueId, incarnation, "Original backup body")).status).toBe(200);
      const receipt = await source.backup(),
        objects = await source.exportBackup(receipt.key);
      const corrupt = objects.map((object) =>
        object.key.endsWith("/documents.json") ? { ...object, data: "[]" } : object,
      );
      await target.importBackup(corrupt);
      await expect(target.restoreBackup(receipt.key)).rejects.toThrow(/hash mismatch/);
      expect((await target.backupTables())["organization"]).toEqual([]);
      await target.importBackup(objects);
      expect((await target.restoreBackup(receipt.key)).key).toBe(receipt.key);
      await used.occupyRestoreTarget();
      const original = await used.backupTables();
      await used.importBackup(objects);
      await expect(used.restoreBackup(receipt.key)).rejects.toThrow(/not empty/);
      expect(await used.backupTables()).toEqual(original);
    } finally {
      await used.close();
      await target.close();
      await source.close();
    }
  }, 30_000);

  it("refuses a durable body whose mirror publication failed, then backs it up after reconciliation", async () => {
    const runtime = await startPreviewRuntime({ backups: true });
    try {
      await initialBackup(runtime);
      const { issueId, incarnation } = await createIssue(runtime);
      expect((await writeBody(runtime, issueId, incarnation, "Published body")).status).toBe(200);
      await runtime.failDocumentPublication(true);
      expect((await writeBody(runtime, issueId, incarnation, "Durable body awaiting its mirror")).status).toBe(500);
      await runtime.failDocumentPublication(false);
      const before = await manifests(runtime);
      const auditBefore = (await runtime.inspect()).events.filter((event) => event["type"] === "SnapshotTaken");
      await expect(runtime.backup()).rejects.toThrow(/inconsistent/);
      expect(await manifests(runtime)).toEqual(before);
      expect((await runtime.inspect()).events.filter((event) => event["type"] === "SnapshotTaken")).toEqual(
        auditBefore,
      );
      expect((await runtime.fetch(`/sync/document?${new URLSearchParams({ issueId, incarnation })}`)).status).toBe(200);
      expect((await runtime.backup()).key).toBeTruthy();
      expect((await manifests(runtime)).length).toBe(before.length + 1);
    } finally {
      await runtime.close();
    }
  }, 30_000);

  it("arms weekly recovery and triggers the 10,000-main-sequence boundary through its durable alarm job", async () => {
    const runtime = await startPreviewRuntime({ backups: true });
    try {
      await initialBackup(runtime);
      const jobs = (await runtime.backupTables())["scheduled_job"]!;
      const job = jobs.find((row) => row["kind"] === "workspace-backup")!;
      const state = JSON.parse(String(job["payload"])) as { lastEventSeq: number; manifestKey: string };
      const objects = await runtime.exportBackup(state.manifestKey);
      const manifest = JSON.parse(objects.find((object) => object.key === state.manifestKey)!.data) as {
        createdAt: string;
      };
      const week = 7 * 24 * 60 * 60 * 1000;
      expect(Date.parse(String(job["fire_at"]))).toBeGreaterThanOrEqual(Date.parse(manifest.createdAt) + week);
      expect(Date.parse(String(job["fire_at"]))).toBeLessThanOrEqual(Date.now() + week);
      const { issueId } = await createIssue(runtime);
      await runtime.nextEventSequence(state.lastEventSeq + 9_999);
      const rename = (id: number) =>
        runtime.fetch(
          "/sync/push",
          post({
            clientId: "backup-source-client",
            mutations: [
              {
                id,
                name: "issueUpdate",
                args: { id: issueId, patch: { title: `Sequence boundary ${id}` } },
                ts: new Date().toISOString(),
              },
            ],
          }),
        );
      expect((await rename(2)).status).toBe(200);
      expect(await manifests(runtime)).toEqual([state.manifestKey]);
      expect((await rename(3)).status).toBe(200);
      await expect.poll(async () => (await manifests(runtime)).length, { timeout: 30_000 }).toBe(2);
    } finally {
      await runtime.close();
    }
  }, 30_000);

  it("claims a concurrent isolated restore once before any body or directory import", async () => {
    const source = await startPreviewRuntime({ backups: true });
    const target = await startPreviewRuntime({ backups: true, isolatedRestore: true });
    try {
      await initialBackup(source);
      const { issueId, incarnation, context } = await createIssue(source);
      expect((await writeBody(source, issueId, incarnation, "A single restore winner")).status).toBe(200);
      const receipt = await source.backup();
      await target.importBackup(await source.exportBackup(receipt.key));
      const results = await Promise.allSettled([target.restoreBackup(receipt.key), target.restoreBackup(receipt.key)]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0]!.reason)).toMatch(/already been used/);
      expect(await target.context()).toMatchObject({ actor: context.actor });
      expect((await target.fetch(`/sync/document?${new URLSearchParams({ issueId, incarnation })}`)).status).toBe(200);
    } finally {
      await target.close();
      await source.close();
    }
  }, 30_000);

  it("recovers an overdue job whose alarm was dropped on the next normal commit without restarting", async () => {
    const runtime = await startPreviewRuntime({ backups: true });
    try {
      await initialBackup(runtime);
      const { issueId } = await createIssue(runtime);
      await runtime.backup();
      const before = await manifests(runtime);
      expect(await runtime.dropDueBackupAlarm()).toBeNull();
      expect(await manifests(runtime)).toEqual(before);
      const response = await runtime.fetch(
        "/sync/push",
        post({
          clientId: "backup-source-client",
          mutations: [
            {
              id: 2,
              name: "issueUpdate",
              args: { id: issueId, patch: { title: "Resume overdue recovery" } },
              ts: new Date().toISOString(),
            },
          ],
        }),
      );
      expect(await response.json()).toMatchObject({ ok: true, rejected: [] });
      await expect.poll(async () => (await manifests(runtime)).length, { timeout: 30_000 }).toBe(before.length + 1);
      await expect
        .poll(async () => Date.parse(String((await runtime.backupTables())["scheduled_job"]![0]!["fire_at"])))
        .toBeGreaterThan(Date.now());
    } finally {
      await runtime.close();
    }
  }, 30_000);

  it("keeps an existing body unchanged and quarantines the failed isolated restore", async () => {
    const source = await startPreviewRuntime({ backups: true });
    const target = await startPreviewRuntime({ backups: true, isolatedRestore: true });
    const doc = new Y.Doc();
    try {
      await initialBackup(source);
      const { issueId, incarnation } = await createIssue(source);
      expect((await writeBody(source, issueId, incarnation, "The source backup body")).status).toBe(200);
      const receipt = await source.backup(),
        objects = await source.exportBackup(receipt.key);
      await target.importBackup(objects);
      const archived = (
        JSON.parse(objects.find((object) => object.key.endsWith("/documents.json"))!.data) as BodyBackup[]
      )[0]!;
      doc.getText("description").insert(0, "Existing isolated data must not be overwritten.");
      const bytes = Y.encodeStateAsUpdate(doc);
      const existing: BodyBackup = {
        ...archived,
        state: {
          ...archived.state,
          update: Buffer.from(bytes).toString("base64"),
          mirror: doc.getText("description").toString(),
          contentState: createHash("sha256").update(bytes).digest("hex"),
        },
      };
      expect(await target.primeDocument(existing)).toBe(existing.state.contentState);
      await expect(target.restoreBackup(receipt.key)).rejects.toThrow(/Document restore target is not empty/);
      expect(await target.readDocument(existing)).toEqual(existing.state);
      expect((await target.fetch("/api/context")).status).toBe(503);
      expect(await target.directoryCounts()).toEqual({ accounts: 0, workspaces: 0, members: 0 });
      expect((await target.backupTables())["organization"]).toEqual([]);
      await expect(target.restoreBackup(receipt.key)).rejects.toThrow(/already been used/);
    } finally {
      doc.destroy();
      await target.close();
      await source.close();
    }
  }, 30_000);
});
