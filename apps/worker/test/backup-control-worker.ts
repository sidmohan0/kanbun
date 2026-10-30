import type { DurableObjectNamespace } from "@cloudflare/workers-types";

/** Test-only private dispatcher: keep RPC error serialization inside workerd, not the Node proxy. */
export default {
  async fetch(request: Request, env: { WORKSPACES: DurableObjectNamespace }) {
    const input = (await request.json()) as { action: "backup" | "restore"; workspaceId: string; key?: string };
    const workspace = env.WORKSPACES.getByName(input.workspaceId) as unknown as {
      backup(workspaceId: string): Promise<unknown>;
      restoreBackup(workspaceId: string, key: string): Promise<unknown>;
    };
    try {
      const value =
        input.action === "backup"
          ? await workspace.backup(input.workspaceId)
          : await workspace.restoreBackup(input.workspaceId, input.key!);
      return Response.json({ ok: true, value });
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
};
