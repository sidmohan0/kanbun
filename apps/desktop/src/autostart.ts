import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Linux does not implement Electron's login-item API. The marker prevents us
// from deleting or overwriting a different application's autostart entry.
const marker = "# Managed by Kanbun desktop\n";
export function autostartPath(): string {
  return path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
    "autostart",
    "ai.kanbun.desktop.desktop",
  );
}
export async function linuxAutostart(enabled: boolean, executable: string): Promise<void> {
  const file = autostartPath();
  let existing = "";
  try {
    existing = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing && !existing.startsWith(marker)) throw new Error("Autostart entry is not managed by Kanbun");
  if (!enabled) {
    if (existing) await rm(file);
    return;
  }
  if (/[\n\r]/u.test(executable)) throw new Error("Invalid executable path");
  const escaped = executable
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("`", "\\`")
    .replaceAll("$", "\\$")
    .replaceAll("%", "%%");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `${marker}[Desktop Entry]\nType=Application\nName=Kanbun\nExec="${escaped}" --background\nTryExec=${executable}\nX-GNOME-Autostart-enabled=true\n`,
    { mode: 0o600 },
  );
}
