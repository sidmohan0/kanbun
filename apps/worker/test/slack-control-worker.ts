import type { DurableObjectNamespace } from "@cloudflare/workers-types";
type Control = {
  slackTestAlarm(): Promise<void>;
  slackTestSnapshot(): Promise<unknown>;
  slackTestGate(): Promise<void>;
  slackTestPending(): Promise<boolean>;
  slackTestRelease(): Promise<void>;
  slackTestAgeReplies(minutes: number): Promise<void>;
};
export default {
  async fetch(request: Request, env: { WORKSPACES: DurableObjectNamespace }) {
    const { action, workspaceId, minutes } = (await request.json()) as {
      action: string;
      workspaceId: string;
      minutes?: number;
    };
    const workspace = env.WORKSPACES.getByName(workspaceId) as unknown as Control;
    try {
      const value =
        action === "ageReplies" && typeof minutes === "number"
          ? await workspace.slackTestAgeReplies(minutes)
          : action === "alarm"
            ? await workspace.slackTestAlarm()
            : action === "snapshot"
              ? await workspace.slackTestSnapshot()
              : action === "gate"
                ? await workspace.slackTestGate()
                : action === "pending"
                  ? await workspace.slackTestPending()
                  : action === "release"
                    ? await workspace.slackTestRelease()
                    : null;
      return Response.json(value ?? null);
    } catch {
      return Response.json({ error: "Slack test alarm failed" }, { status: 500 });
    }
  },
};
