import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function runHook(provider: string, directory: string, input: string): Promise<void> {
  try {
    const payload = JSON.parse(input) as Record<string, unknown>;
    if (
      (provider !== "codex" && provider !== "claude") ||
      !directory ||
      typeof payload.session_id !== "string" ||
      typeof payload.hook_event_name !== "string"
    )
      return;
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
    // Hooks must never block or change the agent's behavior.
  }
}

async function runHookFromStream(
  provider: string,
  directory: string,
  stream: AsyncIterable<unknown>,
  stopOnComplete: boolean,
): Promise<void> {
  let input = "";
  for await (const chunk of stream) {
    input += String(chunk);
    if (input.length > 1_000_000) return;
    try {
      const payload = JSON.parse(input) as Record<string, unknown>;
      if (typeof payload.session_id === "string" && typeof payload.hook_event_name === "string") {
        if (stopOnComplete) {
          await runHook(provider, directory, input);
          return;
        }
      }
    } catch {
      // The payload may still be arriving in later chunks.
    }
  }
  await runHook(provider, directory, input);
}

export async function runHookFromStdin(provider: string, directory: string): Promise<void> {
  await runHookFromStream(provider, directory, process.stdin, true);
}

export async function runHookFromFile(provider: string, directory: string, filename: string): Promise<void> {
  const stream = createReadStream(filename);
  if (process.env.KANBUN_HOOK_DIAGNOSTICS === "1") {
    stream.once("open", () => process.stderr.write("hook fifo opened\n"));
    stream.once("end", () => process.stderr.write("hook fifo reached EOF\n"));
  }
  await runHookFromStream(provider, directory, stream, false);
}
