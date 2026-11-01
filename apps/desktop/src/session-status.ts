export type Provider = "codex" | "claude";
export type LiveStatus = "running" | "waiting" | "idle" | "ended" | "stale" | "unknown";
export type HookEvent = {
  provider: Provider;
  sessionId: string;
  event: string;
  observedAt: number;
  notificationType?: string;
};
export type Observation = { status: Exclude<LiveStatus, "stale">; observedAt: number };

/** Hook delivery is advisory: absence of an event never establishes inactivity. */
export function applyHook(previous: Observation | undefined, event: HookEvent): Observation | undefined {
  if (!Number.isFinite(event.observedAt) || (previous && event.observedAt < previous.observedAt)) return previous;
  if (event.event === "SessionStart") return { status: "unknown", observedAt: event.observedAt };
  let status: Observation["status"] | undefined;
  switch (event.event) {
    case "UserPromptSubmit":
      status = "running";
      break;
    case "PreToolUse":
    case "PostToolUse":
    case "PostToolUseFailure":
      // Another concurrent tool can finish while an approval is still open.
      if (previous?.status === "waiting" || previous?.status === "unknown")
        return { status: "unknown", observedAt: event.observedAt };
      status = "running";
      break;
    case "PermissionRequest":
      status = "waiting";
      break;
    case "Notification":
      if (
        event.notificationType === "permission_prompt" ||
        event.notificationType === "elicitation_dialog" ||
        event.notificationType === "elicitation_url_dialog"
      )
        status = "waiting";
      else if (event.notificationType === "idle_prompt") status = "idle";
      break;
    case "Stop":
    case "Interrupt":
    case "StopFailure":
      status = "idle";
      break;
    case "SessionEnd":
      status = "ended";
      break;
  }
  return status ? { status, observedAt: event.observedAt } : previous;
}

export function statusAt(observation: Observation | undefined, now: number, staleAfterMs: number): LiveStatus {
  if (!observation || !Number.isFinite(now) || now < observation.observedAt) return "unknown";
  if (observation.status === "unknown") return "unknown";
  return now - observation.observedAt > staleAfterMs ? "stale" : observation.status;
}
