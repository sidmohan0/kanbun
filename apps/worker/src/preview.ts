import { uuidv7 } from "@kanbun/model";
import type { WorkspaceContext } from "@kanbun/sync";
import type { SqlDriver, SyncServer } from "@kanbun/sync/server";
import { RequestError } from "./requests";

/** Initialize only the real owner and an empty starter team; the directory remains authority. */
export function preparePreview(server: SyncServer, driver: SqlDriver, context: WorkspaceContext) {
  return driver.transaction(() => {
    const organization = server.store.list("organization")[0];
    if (organization && organization.id !== context.workspaceId)
      throw new RequestError("Workspace directory does not match its authority", 403);
    if (!context.email) throw new RequestError("Owner email is required", 403);
    if (!organization)
      server.system("workspaceInit", {
        organization: {
          id: context.workspaceId,
          name: context.workspaceName,
          urlKey: `preview-${context.workspaceId.slice(0, 8)}`,
        },
        owner: { id: context.actor.id, name: context.name, email: context.email },
      });
    const member = server.store.get("user", context.actor.id);
    if (!member || !member.active || member.archivedAt || member.role !== "owner")
      throw new RequestError("Active workspace owner membership is required", 403);
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
