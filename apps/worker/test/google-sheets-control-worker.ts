import type { DurableObjectNamespace } from "@cloudflare/workers-types";

type Control = {
  sheetsTestGateConnection(): Promise<void>;
  sheetsTestConnectionPending(): Promise<boolean>;
  sheetsTestReleaseConnection(): Promise<void>;
  sheetsTestSchedule(): Promise<unknown>;
  sheetsTestAlarm(): Promise<void>;
};
/** Test-only HTTP boundary ends each control RPC's lifetime before object eviction. */
export default {
  async fetch(request: Request, env: { WORKSPACES: DurableObjectNamespace }) {
    const { action, workspaceId } = (await request.json()) as { action: string; workspaceId: string };
    const workspace = env.WORKSPACES.getByName(workspaceId) as unknown as Control;
    let value: unknown;
    if (action === "gate") value = await workspace.sheetsTestGateConnection();
    else if (action === "pending") value = await workspace.sheetsTestConnectionPending();
    else if (action === "release") value = await workspace.sheetsTestReleaseConnection();
    else if (action === "schedule") value = await workspace.sheetsTestSchedule();
    else if (action === "alarm") value = await workspace.sheetsTestAlarm();
    else return new Response("Unknown control", { status: 400 });
    return Response.json(value ?? null);
  },
};
