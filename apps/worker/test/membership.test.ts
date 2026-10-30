import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { issueIncarnation, type BootstrapResponse, type WorkspaceContext } from "@kanbun/sync";
import { startPreviewRuntime } from "./preview-runtime";

type Runtime = Awaited<ReturnType<typeof startPreviewRuntime>>;
type Invitation = { invitation: { id: string }; token: string; url: string };
const id = (n: number) => `019a0000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const post = (input: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(input),
});
async function invite(runtime: Runtime, email = "member@example.com") {
  const response = await runtime.fetch("/api/invitations", post({ email }));
  expect(response.status).toBe(200);
  return response.json() as Promise<Invitation>;
}
async function accept(runtime: Runtime, invitation: Invitation, assertion: string) {
  return runtime.fetch("/api/invitations/accept", post({ token: invitation.token }), assertion);
}
const memberToken = (runtime: Runtime, overrides: Record<string, unknown> = {}) =>
  runtime.token({ sub: "member-subject", email: "member@example.com", name: "Invited member", ...overrides });

describe("invited workspace membership in workerd", () => {
  it("admits only the targeted identity, handles concurrent acceptance, and exposes owner-only management", async () => {
    const runtime = await startPreviewRuntime();
    try {
      const owner = await runtime.context();
      const token = await memberToken(runtime);
      expect((await runtime.fetch("/api/context", {}, token)).status).toBe(403);
      expect((await runtime.fetch("/", {}, token)).status).toBe(200);
      expect(await runtime.directoryCounts()).toEqual({ accounts: 1, workspaces: 1, members: 1 });
      const invitation = await invite(runtime);
      expect(invitation.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(new URL(invitation.url).hash).toBe(`#invite/${invitation.token}`);
      const listed = await (await runtime.fetch("/api/members")).text();
      expect(listed).not.toContain(invitation.token);
      expect(listed).not.toContain("token_hash");
      const other = await memberToken(runtime, { sub: "other", email: "other@example.com" });
      expect((await runtime.fetch("/api/invitations/inspect", post({ token: invitation.token }), other)).status).toBe(
        403,
      );
      expect((await accept(runtime, invitation, other)).status).toBe(403);
      expect((await runtime.fetch("/api/invitations/inspect", post({ token: invitation.token }), token)).status).toBe(
        200,
      );
      expect(await runtime.directoryCounts()).toEqual({ accounts: 1, workspaces: 1, members: 1 });
      const accepted = await Promise.all([accept(runtime, invitation, token), accept(runtime, invitation, token)]);
      expect(accepted.map((response) => response.status)).toEqual([200, 200]);
      const member = (await accepted[0]!.json()) as WorkspaceContext;
      expect(member).toMatchObject({
        role: "member",
        admissionId: invitation.invitation.id,
        email: "member@example.com",
        workspaceId: owner.workspaceId,
      });
      expect(await runtime.context(token)).toEqual(member);
      expect(await (await accept(runtime, invitation, token)).json()).toEqual(member);
      expect(await runtime.directoryCounts()).toEqual({ accounts: 2, workspaces: 1, members: 2 });
      expect((await runtime.fetch("/api/members", {}, token)).status).toBe(403);
      expect((await runtime.fetch("/api/invitations", post({ email: "third@example.com" }), token)).status).toBe(403);
      expect((await runtime.fetch("/api/members/remove", post({ userId: owner.actor.id }), token)).status).toBe(403);
      expect((await runtime.fetch("/api/members/remove", post({ userId: owner.actor.id }))).status).toBe(403);
      expect(
        (await runtime.fetch("/api/invitations", post({ email: "third@example.com", role: "owner" }))).status,
      ).toBe(400);
      const members = (await (await runtime.fetch("/api/members")).json()) as {
        members: { userId: string; role: string; active: boolean }[];
      };
      expect(members.members).toContainEqual(
        expect.objectContaining({ userId: member.actor.id, role: "member", active: true }),
      );
      const current = await runtime.inspect();
      const forged = post({
        clientId: "member-forged-actor",
        mutations: [
          {
            id: 1,
            name: "issueCreate",
            ts: new Date().toISOString(),
            args: {
              id: id(500),
              teamId: current.rows.team![0]!["id"],
              title: "Attributed to actual member",
              subscriptionId: id(501),
              creatorId: owner.actor.id,
            },
          },
        ],
      });
      forged.headers = {
        "content-type": "application/json",
        "X-Kanbun-Principal": encodeURIComponent(JSON.stringify(owner)),
        "X-Kanbun-Local-Actor": "alice",
        "X-Kanbun-Workspace": id(999),
      };
      expect(await (await runtime.fetch("/sync/push", forged, token)).json()).toMatchObject({ ok: true, rejected: [] });
      expect((await runtime.inspect()).rows.issue).toContainEqual(
        expect.objectContaining({ id: id(500), creatorId: member.actor.id }),
      );
      const escalation = post({
        clientId: "member-escalation",
        mutations: [
          {
            id: 1,
            name: "memberSync",
            ts: new Date().toISOString(),
            args: {
              id: member.actor.id,
              name: member.name,
              email: member.email,
              role: "owner",
              active: true,
              directoryAdmissionId: id(502),
            },
          },
        ],
      });
      expect(await (await runtime.fetch("/sync/push", escalation, token)).json()).toMatchObject({
        ok: true,
        rejected: [{ id: 1, error: expect.stringMatching(/system-only/) }],
      });
      await runtime.restart();
      expect(await runtime.context(token)).toEqual(member);
    } finally {
      await runtime.close();
    }
  }, 30000);

  it("rejects expired, revoked and foreign-subject invitations without linking accounts by email", async () => {
    const runtime = await startPreviewRuntime();
    try {
      await runtime.context();
      const token = await memberToken(runtime);
      const expired = await invite(runtime);
      await runtime.expireInvitation(expired.invitation.id);
      expect((await accept(runtime, expired, token)).status).toBe(403);
      const revoked = await invite(runtime);
      expect((await runtime.fetch("/api/invitations/revoke", post({ id: revoked.invitation.id }))).status).toBe(200);
      expect((await accept(runtime, revoked, token)).status).toBe(403);
      expect(await runtime.directoryCounts()).toEqual({ accounts: 1, workspaces: 1, members: 1 });
      const valid = await invite(runtime);
      expect((await accept(runtime, valid, token)).status).toBe(200);
      const member = await runtime.context(token);
      expect((await runtime.fetch("/api/members/remove", post({ userId: member.actor.id }))).status).toBe(200);
      const fresh = await invite(runtime);
      const collision = await memberToken(runtime, { sub: "different-subject-same-email" });
      expect((await accept(runtime, fresh, collision)).status).toBe(403);
      expect((await runtime.fetch("/api/context", {}, collision)).status).toBe(403);
      expect(await runtime.directoryCounts()).toEqual({ accounts: 2, workspaces: 1, members: 2 });
      expect((await runtime.fetch("/api/invitations/inspect?token=never-send-a-token-here", {}, token)).status).toBe(
        405,
      );
    } finally {
      await runtime.close();
    }
  }, 30000);

  it("recovers a D1 admission after projection failure but never reactivates an inactive member on ordinary sign-in", async () => {
    const runtime = await startPreviewRuntime();
    try {
      await runtime.context();
      const token = await memberToken(runtime);
      const invitation = await invite(runtime);
      await runtime.failMemberAdmission(true);
      expect((await accept(runtime, invitation, token)).status).toBe(500);
      expect(await runtime.directoryCounts()).toEqual({ accounts: 2, workspaces: 1, members: 2 });
      await runtime.failMemberAdmission(false);
      await runtime.restart();
      const member = await runtime.context(token);
      expect(member.admissionId).toBe(invitation.invitation.id);
      await runtime.setMemberState(member.actor.id, false);
      expect((await runtime.fetch("/api/context", {}, token)).status).toBe(403);
      expect((await accept(runtime, invitation, token)).status).toBe(403);
      await runtime.restart();
      expect((await runtime.fetch("/api/context", {}, token)).status).toBe(403);
    } finally {
      await runtime.close();
    }
  }, 30000);

  it("revokes sockets and stale admissions, and readmits without restoring old private-team grants or content", async () => {
    const runtime = await startPreviewRuntime();
    let connection: Awaited<ReturnType<Runtime["connect"]>> | undefined;
    const doc = new Y.Doc();
    try {
      await runtime.context();
      const token = await memberToken(runtime);
      const invitation = await invite(runtime);
      const outstanding = await invite(runtime);
      expect((await accept(runtime, invitation, token)).status).toBe(200);
      const member = await runtime.context(token);
      const teamId = id(200);
      const issueId = id(201);
      const seeded = await runtime.fetch(
        "/sync/push",
        post({
          clientId: "membership-private-fixture",
          mutations: [
            {
              id: 1,
              name: "teamCreate",
              ts: new Date().toISOString(),
              args: {
                id: teamId,
                name: "Private",
                key: "PRIV",
                visibility: "private",
                membershipId: id(202),
                stateIds: { backlog: id(203), todo: id(204), inProgress: id(205), done: id(206), canceled: id(207) },
              },
            },
            {
              id: 2,
              name: "teamMembershipCreate",
              ts: new Date().toISOString(),
              args: { id: id(208), teamId, userId: member.actor.id },
            },
            {
              id: 3,
              name: "issueCreate",
              ts: new Date().toISOString(),
              args: { id: issueId, teamId, title: "Private issue", subscriptionId: id(209) },
            },
            {
              id: 4,
              name: "commentCreate",
              ts: new Date().toISOString(),
              args: { id: id(210), issueId, body: "Private discussion" },
            },
          ],
        }),
      );
      expect(await seeded.json()).toMatchObject({ ok: true, rejected: [] });
      const bootstrap = (await (
        await runtime.fetch("/sync/bootstrap?clientId=member-private", {}, token)
      ).json()) as BootstrapResponse;
      const issue = bootstrap.rows.issue!.find((row) => row["id"] === issueId)!;
      const incarnation = issueIncarnation(issue as unknown as Parameters<typeof issueIncarnation>[0]);
      doc.getText("description").insert(0, "Private description");
      const body = { issueId, incarnation, update: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64") };
      expect((await runtime.fetch("/sync/document", post(body), token)).status).toBe(200);
      connection = await runtime.connect("member-socket", token);
      await expect.poll(() => connection!.messages.length).toBeGreaterThan(0);
      expect((await runtime.fetch("/api/members/remove", post({ userId: member.actor.id }))).status).toBe(200);
      expect((await connection.closed).code).toBe(1008);
      expect((await runtime.fetch("/api/context", {}, token)).status).toBe(403);
      expect((await accept(runtime, invitation, token)).status).toBe(403);
      expect((await accept(runtime, outstanding, token)).status).toBe(403);
      const fresh = await invite(runtime);
      expect((await accept(runtime, fresh, token)).status).toBe(200);
      const readmitted = await runtime.context(token);
      expect(readmitted.actor).toEqual(member.actor);
      expect(readmitted.admissionId).not.toBe(member.admissionId);
      expect((await accept(runtime, invitation, token)).status).toBe(403);
      expect(
        (await runtime.fetch("/api/context", { headers: { "X-Kanbun-Admission": member.admissionId! } }, token)).status,
      ).toBe(403);
      const currentHeaders = { "X-Kanbun-Admission": readmitted.admissionId! };
      const current = (await (
        await runtime.fetch("/sync/bootstrap?clientId=readmitted", { headers: currentHeaders }, token)
      ).json()) as BootstrapResponse;
      expect(JSON.stringify(current.rows)).not.toContain("Private issue");
      expect(JSON.stringify(current.rows)).not.toContain("Private description");
      for (const path of [
        `/sync/document?issueId=${issueId}&incarnation=${encodeURIComponent(incarnation)}`,
        `/sync/load?model=comment&parentId=${issueId}`,
      ])
        expect((await runtime.fetch(path, { headers: currentHeaders }, token)).status).toBe(403);
      for (const path of [
        `/sync/events?entityId=${issueId}`,
        `/sync/activity?rowId=${issueId}`,
        "/sync/pull?clientId=readmitted&since=0",
      ]) {
        const response = await runtime.fetch(path, { headers: currentHeaders }, token);
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).not.toContain("Private description");
        expect(text).not.toContain("Private issue");
        expect(text).not.toContain("Private discussion");
      }
      expect((await runtime.fetch("/sync/document", post(body), token)).status).toBe(403);
      const forged = await runtime.fetch(
        "/sync/push",
        post({ clientId: "forged-workspace", workspaceId: "someone-else", mutations: [] }),
        token,
      );
      expect(forged.status).toBe(400);
      await runtime.restart();
      expect((await runtime.fetch("/sync/bootstrap?clientId=readmitted-after-restart", {}, token)).status).toBe(200);
    } finally {
      connection?.close();
      doc.destroy();
      await runtime.close();
    }
  }, 30000);
});
