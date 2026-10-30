import type { Row } from "@kanbun/model";
import type { BootstrapResponse } from "@kanbun/sync";
import { createTestHarness } from "wrangler";
import { fileURLToPath } from "node:url";

export { startPreviewRuntime } from "./preview-runtime";

export type RuntimeSnapshot = {
  seq: number;
  issues: Row<"issue">[];
  clients: Record<string, unknown>[];
  log: Record<string, unknown>[];
  events: Record<string, unknown>[];
  branches: Record<string, unknown>[];
  migrations: Record<string, unknown>[];
  overlays: Record<string, unknown>[];
  teams: Record<string, unknown>[];
};

/** Shared Node test adapter; the Worker and all SQL execute in workerd. */
export async function startWorkspaceRuntime({ localDev = true }: { localDev?: boolean } = {}) {
  const harness = createTestHarness({
    root: fileURLToPath(new URL("..", import.meta.url)),
    workers: [{ configPath: "wrangler.json", vars: { LOCAL_DEV: localDev ? "true" : "false" } }],
  });
  try {
    const { url } = await harness.listen();
    const origin = url.origin;
    const request = (path: string, init?: RequestInit) => fetch(new URL(path, origin), init);
    return {
      origin,
      fetch: request,
      async seed(seedIssue = true): Promise<{ teamId: string; issueId: string }> {
        const response = await request("/__local/seed", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ seedIssue }),
        });
        if (!response.ok) throw new Error(`Local Worker seed failed (${response.status}): ${await response.text()}`);
        return response.json() as Promise<{ teamId: string; issueId: string }>;
      },
      async inspect(): Promise<RuntimeSnapshot> {
        // Bootstrap uses the real API's row normalization. This fixture client never mutates;
        // last-seen timestamps are excluded from the bookkeeping snapshot below.
        const response = await request("/sync/bootstrap?clientId=runtime-inspector");
        if (!response.ok) throw new Error(`Worker inspection bootstrap failed (${response.status})`);
        const bootstrap = (await response.json()) as BootstrapResponse;
        const storage = await harness.getWorker().getDurableObjectStorage("WORKSPACES", { name: "local" });
        const query = (sql: string) => storage.exec(sql);
        const [clients, log, events, branches, migrations, overlays, teams] = await Promise.all([
          query("SELECT client_id, user_id, branch_id, last_mutation_id FROM sync_client ORDER BY client_id"),
          query("SELECT * FROM sync_log ORDER BY seq"),
          query("SELECT * FROM event_log ORDER BY seq"),
          query("SELECT * FROM workspace_branch ORDER BY id"),
          query("SELECT * FROM __migrations ORDER BY tag"),
          query("SELECT * FROM branch_row ORDER BY branch_id, entity_type, entity_id"),
          query("SELECT * FROM team ORDER BY id"),
        ]);
        return {
          seq: bootstrap.seq,
          issues: (bootstrap.rows.issue ?? []) as Row<"issue">[],
          clients,
          log,
          events,
          branches,
          migrations,
          overlays,
          teams,
        };
      },
      async restart() {
        await harness.getWorker().evictDurableObject("WORKSPACES", { name: "local", webSockets: "close" });
      },
      async hibernate() {
        await harness.getWorker().evictDurableObject("WORKSPACES", { name: "local", webSockets: "hibernate" });
      },
      async setMemberActive(actor: "alice" | "bob", active: boolean) {
        // Trusted fixture control for revocation tests; no HTTP administration route.
        const storage = await harness.getWorker().getDurableObjectStorage("WORKSPACES", { name: "local" });
        await storage.exec('UPDATE "user" SET active = ? WHERE id = ?', active ? 1 : 0, `user-${actor}`);
      },
      close: () => harness.close(),
    };
  } catch (error) {
    await harness.close();
    throw error;
  }
}
