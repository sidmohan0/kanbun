import { expect, it } from "vitest";
import { uuidv7 } from "@kanbun/model";
import type { BootstrapResponse, PushResponse, WorkspaceContext } from "@kanbun/sync";
import { startPreviewRuntime } from "./preview-runtime";

type Runtime = Awaited<ReturnType<typeof startPreviewRuntime>>;
const post = (value: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});
const memberIdentity = {
  sub: "notification-member",
  email: "notification-member@example.com",
  name: "Notification member",
};
async function admit(runtime: Runtime) {
  await runtime.context();
  const invitation = (await (
    await runtime.fetch("/api/invitations", post({ email: memberIdentity.email }))
  ).json()) as { token: string };
  const token = await runtime.token(memberIdentity);
  const response = await runtime.fetch("/api/invitations/accept", post({ token: invitation.token }), token);
  expect(response.status).toBe(200);
  return { token, context: (await response.json()) as WorkspaceContext };
}
async function push(runtime: Runtime, name: string, args: unknown, token?: string) {
  const request = post({ clientId: uuidv7(), mutations: [{ id: 1, name, args, ts: "2026-10-30T00:00:00.000Z" }] });
  const response = await runtime.fetch("/sync/push", request, token);
  expect(response.status).toBe(200);
  const result = (await response.json()) as PushResponse;
  return { result, request };
}
async function inbox(runtime: Runtime, token: string) {
  const response = await runtime.fetch(`/sync/bootstrap?clientId=${uuidv7()}`, undefined, token);
  expect(response.status).toBe(200);
  return ((await response.json()) as BootstrapResponse).rows.notification ?? [];
}
const settled = (runtime: Runtime) =>
  expect.poll(async () => (await runtime.notificationProgress()).settled).toBe(true);

it("persists consumer progress/read state, sanitizes failure, isolates backup failure, and restores inbox/checkpoint coherently", async () => {
  const runtime = await startPreviewRuntime({ backups: true });
  const restored = await startPreviewRuntime({ backups: true, isolatedRestore: true });
  try {
    const member = await admit(runtime);
    await expect
      .poll(async () => (await runtime.backupKeys()).some((key) => key.endsWith("/manifest.json")))
      .toBe(true);
    const teamId = String((await runtime.inspect()).rows.team![0]!["id"]),
      issueId = uuidv7();
    expect(
      (
        await push(runtime, "issueCreate", {
          id: issueId,
          teamId,
          title: "Current authorized title",
          subscriptionId: uuidv7(),
          assigneeId: member.context.actor.id,
        })
      ).result,
    ).toMatchObject({ ok: true, rejected: [] });
    await settled(runtime);
    const assignment = (await inbox(runtime, member.token))[0]!;
    expect(assignment).toMatchObject({ type: "assignment", recipientAdmissionId: member.context.admissionId });
    expect((await push(runtime, "notificationRead", { id: assignment["id"], read: true })).result).toMatchObject({
      ok: true,
      rejected: [expect.anything()],
    });
    expect(
      (await push(runtime, "notificationRead", { id: assignment["id"], read: true }, member.token)).result,
    ).toMatchObject({ ok: true, rejected: [] });
    await runtime.restart();
    expect(await inbox(runtime, member.token)).toMatchObject([{ id: assignment["id"], readAt: expect.any(String) }]);
    await runtime.notificationFault(true);
    const comment = await push(runtime, "commentCreate", {
      id: uuidv7(),
      issueId,
      body: "Private source text stays out of error reporting",
      mentionedUserIds: [member.context.actor.id],
    });
    expect(comment.result).toMatchObject({ ok: true, rejected: [] });
    const failed = await runtime.notificationAlarmResult();
    expect(failed).toEqual({ ok: false, error: "Workspace scheduled maintenance failed" });
    expect(JSON.stringify(failed)).not.toContain("fixture-private");
    expect(await inbox(runtime, member.token)).toHaveLength(1);
    await runtime.notificationFault(false);
    expect(await runtime.notificationAlarmResult()).toEqual({ ok: true });
    await settled(runtime);
    expect(await inbox(runtime, member.token)).toHaveLength(2);
    expect(await (await runtime.fetch("/sync/push", comment.request)).json()).toMatchObject({ ok: true, rejected: [] });
    await settled(runtime);
    expect(await inbox(runtime, member.token)).toHaveLength(2);
    await runtime.failBackupsForNotifications(true);
    expect(
      (
        await push(runtime, "commentCreate", {
          id: uuidv7(),
          issueId,
          body: "An independent notification",
          mentionedUserIds: [member.context.actor.id],
        })
      ).result,
    ).toMatchObject({ ok: true, rejected: [] });
    expect(await runtime.notificationAlarmResult()).toEqual({
      ok: false,
      error: "Workspace scheduled maintenance failed",
    });
    await settled(runtime);
    expect(await inbox(runtime, member.token)).toHaveLength(3);
    await runtime.failBackupsForNotifications(false);
    expect(await runtime.notificationAlarmResult()).toEqual({ ok: true });
    await settled(runtime);
    const before = await inbox(runtime, member.token);
    const checkpoint = await runtime.notificationProgress();
    const receipt = await runtime.backup();
    await restored.importBackup(await runtime.exportBackup(receipt.key));
    await restored.restoreBackup(receipt.key);
    const restoredToken = await restored.token(memberIdentity);
    expect(await inbox(restored, restoredToken)).toEqual(before);
    const restoredCheckpoint = await restored.notificationProgress();
    expect(restoredCheckpoint.cursor).toBe(checkpoint.cursor);
    expect(restoredCheckpoint.settled).toBe(true);
    expect(await restored.notificationAlarmResult()).toEqual({ ok: true });
    expect(await inbox(restored, restoredToken)).toEqual(before);
  } finally {
    await Promise.allSettled([runtime.close(), restored.close()]);
  }
});

it("fresh re-invitation cannot reopen the previous admission's inbox or accept a stale browser generation", async () => {
  const runtime = await startPreviewRuntime();
  try {
    const first = await admit(runtime);
    const teamId = String((await runtime.inspect()).rows.team![0]!["id"]),
      issueId = uuidv7();
    expect(
      (
        await push(runtime, "issueCreate", {
          id: issueId,
          teamId,
          title: "Before removal",
          subscriptionId: uuidv7(),
          assigneeId: first.context.actor.id,
        })
      ).result,
    ).toMatchObject({ ok: true, rejected: [] });
    await settled(runtime);
    expect(await inbox(runtime, first.token)).toHaveLength(1);
    expect((await runtime.fetch("/api/members/remove", post({ userId: first.context.actor.id }))).status).toBe(200);
    expect((await runtime.fetch("/sync/bootstrap?clientId=removed-inbox", undefined, first.token)).status).toBe(403);
    const second = await admit(runtime);
    expect(second.context.admissionId).not.toBe(first.context.admissionId);
    expect(await inbox(runtime, second.token)).toEqual([]);
    const stale = await runtime.fetch(
      "/sync/bootstrap?clientId=stale-inbox",
      { headers: { "X-Kanbun-Admission": first.context.admissionId! } },
      second.token,
    );
    expect(stale.status).toBe(403);
    expect(await stale.text()).not.toContain("Before removal");
    expect((await push(runtime, "issueUpdate", { id: issueId, patch: { assigneeId: null } })).result).toMatchObject({
      ok: true,
      rejected: [],
    });
    expect(
      (await push(runtime, "issueUpdate", { id: issueId, patch: { assigneeId: second.context.actor.id } })).result,
    ).toMatchObject({ ok: true, rejected: [] });
    await settled(runtime);
    const current = await inbox(runtime, second.token);
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ recipientAdmissionId: second.context.admissionId });
  } finally {
    await runtime.close();
  }
});
