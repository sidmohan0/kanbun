import { readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { applyHook, statusAt, type HookEvent, type Observation } from "./session-status.js";

const expiry = 24 * 60 * 60 * 1000;
const freshness = 5 * 60 * 1000;
export async function readHookStatuses(directory: string, now = Date.now()): Promise<Map<string, string>> {
  const states = new Map<string, Observation>();
  let files: string[];
  try {
    files = await readdir(directory);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw e;
  }
  for (const file of files.sort()) {
    if (!/^\d+-[0-9a-f-]+\.json$/u.test(file)) continue;
    const pathname = path.join(directory, file);
    try {
      const value: HookEvent = JSON.parse(await readFile(pathname, "utf8"));
      if (
        (value.provider !== "codex" && value.provider !== "claude") ||
        typeof value.sessionId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.sessionId) ||
        typeof value.event !== "string" ||
        !Number.isFinite(value.observedAt)
      )
        continue;
      if (value.observedAt > now + 1000) continue;
      if (now - value.observedAt > expiry) {
        await unlink(pathname);
        continue;
      }
      const key = `${value.provider}:${value.sessionId}`;
      const next = applyHook(states.get(key), value);
      if (next) states.set(key, next);
      else states.delete(key);
    } catch {
      /* Ignore malformed or concurrently removed event files. */
    }
  }
  return new Map([...states].map(([key, value]) => [key, statusAt(value, now, freshness)]));
}
