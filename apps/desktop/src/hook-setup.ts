import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

const events = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "Stop",
  "SessionEnd",
];
const extra = { codex: ["Interrupt"], claude: ["Notification", "PostToolUseFailure", "StopFailure"] };
type Provider = keyof typeof extra;
const marker = "kanbun-session-observer";
function quote(s: string): string {
  return process.platform === "win32" ? `"${s.replaceAll('"', '\\"')}"` : `'${s.replaceAll("'", "'\\''")}'`;
}
export function hookCommand(provider: Provider, executable: string, script: string, spool: string): string {
  const command = `${quote(executable)} ${quote(script)} ${provider} ${quote(spool)}`;
  return process.platform === "win32"
    ? `cmd /d /s /c "set ELECTRON_RUN_AS_NODE=1&& ${command}"`
    : `ELECTRON_RUN_AS_NODE=1 ${command}`;
}
export async function configureHooks(
  provider: Provider,
  enabled: boolean,
  executable: string,
  script: string,
  spool: string,
  home = os.homedir(),
): Promise<void> {
  const file = path.join(
    home,
    provider === "codex" ? ".codex" : ".claude",
    provider === "codex" ? "hooks.json" : "settings.json",
  );
  let config: Record<string, unknown> = {};
  let original: string | undefined;
  try {
    if ((await lstat(file)).isSymbolicLink()) throw new Error("Provider settings cannot be a symbolic link");
    original = await readFile(file, "utf8");
    const value: unknown = JSON.parse(original);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid settings");
    config = value as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const hooks = config.hooks ?? {};
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) throw new Error("Invalid hook configuration");
  const next = { ...(hooks as Record<string, unknown>) };
  for (const event of [...events, ...extra[provider]]) {
    const old = next[event] ?? [];
    if (!Array.isArray(old)) throw new Error(`Invalid ${event} hook configuration`);
    const retained = old.flatMap((entry: unknown) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [entry];
      const group = entry as Record<string, unknown>;
      if (!Array.isArray(group.hooks)) return [entry];
      const remaining = group.hooks.filter(
        (item: unknown) =>
          !(
            item &&
            typeof item === "object" &&
            typeof (item as Record<string, unknown>).command === "string" &&
            ((item as Record<string, unknown>).command as string).includes(marker) &&
            ((item as Record<string, unknown>).command as string).includes("hook.js")
          ),
      );
      return remaining.length ? [{ ...group, hooks: remaining }] : [];
    });
    if (enabled)
      retained.push({
        hooks: [{ type: "command", command: hookCommand(provider, executable, script, spool), timeout: 2 }],
      });
    if (retained.length) next[event] = retained;
    else delete next[event];
  }
  if (Object.keys(next).length) config.hooks = next;
  else delete config.hooks;
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    let current: string | undefined;
    try {
      current = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (current !== original) throw new Error("Provider settings changed during setup; retry");
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
