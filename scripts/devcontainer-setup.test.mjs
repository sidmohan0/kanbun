import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("setup profiles install required packages and only full downloads the browser", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kanbun-setup-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  mkdirSync(path.join(root, ".devcontainer"));
  copyFileSync(new URL("../.devcontainer/setup.sh", import.meta.url), path.join(root, ".devcontainer/setup.sh"));
  const log = path.join(root, "calls");
  writeFileSync(path.join(bin, "git"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(path.join(bin, "pnpm"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\n', { mode: 0o755 });
  const run = (profile) =>
    spawnSync("bash", [path.join(root, ".devcontainer/setup.sh"), profile], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALLS: log },
    });
  for (const [profile, browser] of [
    ["full", true],
    ["deps", false],
  ]) {
    writeFileSync(log, "");
    assert.equal(run(profile).status, 0);
    const calls = readFileSync(log, "utf8");
    assert.match(calls, /install --frozen-lockfile/);
    assert.match(calls, /verify doctor/);
    assert.equal(calls.includes("playwright install --only-shell chromium"), browser);
  }
  writeFileSync(log, "");
  assert.notEqual(run("unknown").status, 0);
  assert.equal(readFileSync(log, "utf8"), "");
});
