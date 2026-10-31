import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Playwright's live trace files must stay off shared host mounts. Export only after exit. */
export async function runWithRecoveryEvidence({ command, args, cwd, destination }) {
  const temporary = await mkdtemp(path.join(tmpdir(), "kanbun-browser-recovery-"));
  let code = 1;
  let report = null;
  try {
    code = await new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd,
        env: { ...process.env, KANBUN_RECOVERY_ARTIFACTS: temporary },
        stdio: "inherit",
      });
      child.once("error", (error) => {
        console.error("Could not start browser recovery tests:", error.message);
        resolve(1);
      });
      child.once("exit", (exitCode, signal) => {
        if (signal) console.error("Browser recovery tests were terminated:", signal);
        resolve(exitCode ?? 1);
      });
    });
    try {
      const result = JSON.parse(await readFile(path.join(temporary, "results.json"), "utf8"));
      if (!result || !Array.isArray(result.suites)) throw new Error("Invalid browser recovery JSON report");
      if (!(await stat(path.join(temporary, "report", "index.html"))).isFile())
        throw new Error("Missing browser recovery HTML report");
      report = result;
    } catch (error) {
      console.error("Browser recovery evidence is incomplete:", error.message);
      code ||= 1;
    }
  } finally {
    try {
      await rm(destination, { recursive: true, force: true });
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(temporary, destination, { recursive: true });
      // JSON attachment paths must address the retained copy, not the temporary directory.
      const retainedPaths = (value) => {
        if (typeof value === "string" && (value === temporary || value.startsWith(temporary + path.sep)))
          return destination + value.slice(temporary.length);
        if (Array.isArray(value)) return value.map(retainedPaths);
        if (value && typeof value === "object")
          return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, retainedPaths(item)]));
        return value;
      };
      if (report)
        await writeFile(path.join(destination, "results.json"), JSON.stringify(retainedPaths(report), null, 2) + "\n");
      await rm(temporary, { recursive: true, force: true });
      console.log("Browser recovery artifacts:", destination);
    } catch (error) {
      console.error("Could not export browser recovery evidence:", error.message);
      console.error("Container-local evidence remains at:", temporary);
      code ||= 1;
    }
  }
  return code;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const directory = fileURLToPath(new URL("..", import.meta.url));
  const args = process.argv.slice(2);
  const preflight = args.includes("--preflight");
  const remaining = args.includes("--remaining");
  if (preflight && remaining) throw new Error("Choose preflight or remaining recovery tests, not both.");
  process.exitCode = await runWithRecoveryEvidence({
    command: "pnpm",
    args: [
      "exec",
      "playwright",
      "test",
      "--config",
      "test/recovery/playwright.config.ts",
      ...args.filter((arg) => !["--preflight", "--remaining"].includes(arg)),
      ...(preflight ? ["--grep", "@preflight"] : remaining ? ["--grep-invert", "@preflight"] : []),
    ],
    cwd: directory,
    destination: path.resolve(directory, preflight ? "../../artifacts/recovery-preflight" : "../../artifacts/recovery"),
  });
}
