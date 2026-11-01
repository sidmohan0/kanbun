import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Runs with ELECTRON_RUN_AS_NODE, consuming hook input without emitting output.
const [provider, directory] = process.argv.slice(2);
let input = "";
for await (const chunk of process.stdin) {
  input += String(chunk);
  if (input.length > 1_000_000) process.exit(0);
}
try {
  const payload = JSON.parse(input) as Record<string, unknown>;
  if (
    (provider !== "codex" && provider !== "claude") ||
    !directory ||
    typeof payload.session_id !== "string" ||
    typeof payload.hook_event_name !== "string"
  )
    process.exit(0);
  const event = {
    provider,
    sessionId: payload.session_id,
    event: payload.hook_event_name,
    observedAt: Date.now(),
    ...(typeof payload.notification_type === "string" ? { notificationType: payload.notification_type } : {}),
  };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, `${event.observedAt}-${randomUUID()}.json`), JSON.stringify(event), {
    flag: "wx",
    mode: 0o600,
  });
} catch {
  /* Hooks must never block or change the agent's behavior. */
}
