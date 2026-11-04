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
export function hookCommand(
  provider: Provider,
  executable: string,
  script: string,
  spool: string,
  platform = process.platform,
): string {
  if (platform === "darwin") {
    const diagnostic = (message: string) =>
      `if [ "\${KANBUN_HOOK_DIAGNOSTICS:-}" = "1" ]; then printf '%s\\n' '${message}' >&2; fi`;
    const launch = `${quote(executable)} kanbun-session-hook ${quote(provider)} ${quote(spool)} "$input_dir/input"`;
    return [
      `umask 077`,
      `input_dir=$(mktemp -d "\${TMPDIR:-/tmp}/kanbun-session-hook.XXXXXX") || exit 1`,
      `trap 'rm -rf "$input_dir"' EXIT`,
      `mkfifo "$input_dir/input" || exit 1`,
      diagnostic("fifo created"),
      `if [ "\${KANBUN_HOOK_DIAGNOSTICS:-}" = "1" ]; then ${launch} "kanbun-hook-diagnostics=\${input_dir}/dispatcher.json" & hook_pid=$!; else ${launch} & hook_pid=$!; fi`,
      diagnostic("app launched"),
      `if [ "\${KANBUN_HOOK_DIAGNOSTICS:-}" = "1" ]; then sleep 2; ps -ww -p "$hook_pid" -o pid=,ppid=,stat=,command= >&2 || true; lsof -n "$input_dir/input" >&2 || true; if [ -f "$input_dir/dispatcher.json" ]; then printf '%s\\n' 'dispatcher details:' >&2; cat "$input_dir/dispatcher.json" >&2; else printf '%s\\n' 'dispatcher diagnostics missing' >&2; fi; fi`,
      `cat > "$input_dir/input"`,
      `input_status=$?`,
      diagnostic("stdin copied"),
      `wait "$hook_pid"`,
      `hook_status=$?`,
      `if [ "\${KANBUN_HOOK_DIAGNOSTICS:-}" = "1" ]; then if [ -f "$input_dir/dispatcher.json" ]; then printf '%s\\n' 'dispatcher details:' >&2; cat "$input_dir/dispatcher.json" >&2; else printf '%s\\n' 'dispatcher diagnostics missing' >&2; fi; fi`,
      diagnostic("app exited"),
      `if [ "$input_status" -ne 0 ]; then exit "$input_status"; fi`,
      `exit "$hook_status"`,
    ].join("; ");
  }
  const command = `${quote(executable)} ${quote(script)} ${provider} ${quote(spool)}`;
  return platform === "win32"
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
      const remaining = group.hooks.filter((item: unknown) => {
        const command = item && typeof item === "object" ? (item as Record<string, unknown>).command : null;
        return !(
          typeof command === "string" &&
          ((command.includes(marker) && command.includes("hook.js")) ||
            (command.includes("kanbun-session-hook") && command.includes("mkfifo") && command.includes(marker)) ||
            command.includes("--kanbun-session-hook") ||
            command.includes("KANBUN_SESSION_HOOK=1"))
        );
      });
      return remaining.length ? [{ ...group, hooks: remaining }] : [];
    });
    if (enabled)
      retained.push({
        hooks: [
          {
            type: "command",
            command: hookCommand(provider, executable, script, spool),
            timeout: process.platform === "darwin" ? 5 : 2,
          },
        ],
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
