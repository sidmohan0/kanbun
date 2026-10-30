import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = mkdtempSync(path.join(os.tmpdir(), "kanbun-container-git-"));
const commands = [
  ["rev-parse", "--show-toplevel"],
  ["rev-parse", "--verify", "HEAD"],
  ["symbolic-ref", "--quiet", "--short", "HEAD"],
  ["status", "--porcelain", "-z"],
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  ["check-ignore", "node_modules/", "packages/sync/node_modules/", "artifacts/verification/"],
];
for (const [index, args] of commands.entries()) {
  const stdout = path.join(directory, `${index}.stdout`);
  const stderr = path.join(directory, `${index}.stderr`);
  const out = openSync(stdout, "w");
  const err = openSync(stderr, "w");
  const result = spawnSync("git", args, { stdio: ["ignore", out, err], timeout: 10000 });
  closeSync(out);
  closeSync(err);
  console.log(
    JSON.stringify({
      command: ["git", ...args],
      status: result.status,
      signal: result.signal,
      error: result.error?.message,
      stdoutBytes: statSync(stdout).size,
      stderrBytes: statSync(stderr).size,
      stdoutSample: readFileSync(stdout, "utf8").split("\0").slice(0, 12).join("\n").slice(0, 2000),
      stderrSample: readFileSync(stderr, "utf8").slice(0, 2000),
    }),
  );
}
