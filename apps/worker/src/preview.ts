import { uuidv7 } from "@kanbun/model";
import type { WorkspaceContext } from "@kanbun/sync";
import type { SqlDriver, SyncServer } from "@kanbun/sync/server";
import { RequestError } from "./requests";

/** A delayed projection of an old removal must not deactivate a newer explicit admission. */
export function projectMembershipRemoval(
  server: SyncServer,
  removal: { userId: string; admissionId: string | null; removed: boolean },
) {
  const member = server.store.get("user", removal.userId);
  if (removal.removed && member && member.role !== "owner" && member.directoryAdmissionId === removal.admissionId)
    server.system("memberSync", { id: member.id, name: member.name, email: member.email, active: false });
}

/** Initialize only the real owner and an empty starter team; the directory remains authority. */
export function preparePreview(
  server: SyncServer,
  driver: SqlDriver,
  context: WorkspaceContext,
  admissionId: string | null,
) {
  return driver.transaction(() => {
    const organization = server.store.list("organization")[0];
    if (organization && organization.id !== context.workspaceId)
      throw new RequestError("Workspace directory does not match its authority", 403);
    if (!context.email) throw new RequestError("Owner email is required", 403);
    if (!organization && context.role !== "owner")
      throw new RequestError("The owner must initialize this workspace", 403);
    if (!organization)
      server.system("workspaceInit", {
        organization: {
          id: context.workspaceId,
          name: context.workspaceName,
          urlKey: `preview-${context.workspaceId.slice(0, 8)}`,
        },
        owner: { id: context.actor.id, name: context.name, email: context.email },
      });
    let member = server.store.get("user", context.actor.id);
    const role = context.role === "owner" ? "owner" : "user";
    const newAdmission =
      context.role === "member" && admissionId !== null && member?.directoryAdmissionId !== admissionId;
    if ((!member && context.role === "member") || newAdmission) {
      server.system("memberSync", {
        id: context.actor.id,
        name: context.name,
        email: context.email,
        role,
        active: true,
        archivedAt: null,
        directoryAdmissionId: admissionId,
        notificationEventFloor: Number(
          driver.all("SELECT COALESCE(MAX(seq),0) AS seq FROM event_log WHERE branch_id = 'main'")[0]?.["seq"] ?? 0,
        ),
      });
      member = server.store.get("user", context.actor.id);
    }
    if (!member || !member.active || member.archivedAt || member.role !== role)
      throw new RequestError("Active workspace membership is required", 403);
    if (member.name !== context.name || member.email !== context.email)
      server.system("memberSync", {
        id: context.actor.id,
        name: context.name,
        email: context.email,
      });
    if (!organization) {
      const seeded = server.push(context.actor, {
        clientId: `preview-initialize:${context.workspaceId}`,
        mutations: [
          {
            id: 1,
            name: "teamCreate",
            args: {
              id: uuidv7(),
              name: "Kanbun",
              key: "KAN",
              visibility: "public",
              membershipId: uuidv7(),
              stateIds: { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() },
            },
            ts: new Date().toISOString(),
          },
        ],
      });
      if (!seeded.ok || seeded.rejected.length) throw new Error("Preview workspace initialization failed");
    }
  });
}
