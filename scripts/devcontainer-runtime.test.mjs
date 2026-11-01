import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "kanbun-runtime-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "scripts"));
  mkdirSync(path.join(root, "bin"));
  copyFileSync(new URL("./devcontainer.sh", import.meta.url), path.join(root, "scripts/devcontainer.sh"));
  const mock = (name, body) => writeFileSync(path.join(root, "bin", name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  mock(
    "docker",
    'case "$*" in "info") [ "${DEFAULT_OK:-0}" = 1 ] ;; "--context colima-kanbun info") [ "${FALLBACK_OK:-0}" = 1 ] ;; "context show") echo default ;; ps*) echo "${CONTAINER_ID:-}" ;; *) exit 0 ;; esac',
  );
  mock("npx", 'case "${GIT_OK:-1}" in 1) exit 0 ;; *) exit 1 ;; esac');
  const run = (args, env = {}) =>
    spawnSync("bash", [path.join(root, "scripts/devcontainer.sh"), ...args], {
      encoding: "utf8",
      env: { PATH: `${path.join(root, "bin")}:${process.env.PATH}`, ...env },
    });
  return { run, root, mock };
}

test("runtime falls back only when no context or host is explicitly selected", (t) => {
  const { run } = fixture(t);
  const fallback = run(["doctor"], { FALLBACK_OK: "1" });
  assert.equal(fallback.status, 0);
  assert.match(fallback.stdout, /Docker context: colima-kanbun/);
  const explicit = run(["doctor"], { FALLBACK_OK: "1", DOCKER_CONTEXT: "bad" });
  assert.notEqual(explicit.status, 0);
  assert.match(explicit.stderr, /explicitly selected/);
  const absent = run(["doctor"]);
  assert.notEqual(absent.status, 0);
  assert.match(absent.stderr, /host agent/);
});

test("doctor detects inaccessible Git metadata in a running container", (t) => {
  const { run } = fixture(t);
  const broken = run(["doctor"], { DEFAULT_OK: "1", CONTAINER_ID: "fixture", GIT_OK: "0" });
  assert.notEqual(broken.status, 0);
  assert.match(broken.stderr, /cannot resolve this checkout Git metadata/);
  const healthy = run(["doctor"], { DEFAULT_OK: "1", CONTAINER_ID: "fixture" });
  assert.equal(healthy.status, 0);
  assert.match(healthy.stdout, /Git metadata: accessible/);
});

test("linked worktree passes its Git common directory as a mount", (t) => {
  const { root } = fixture(t);
  const repository = path.join(root, "source");
  const worktree = path.join(root, "worktree with spaces");
  mkdirSync(repository);
  execFileSync("git", ["init", "-q", repository]);
  execFileSync("git", [
    "-C",
    repository,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-qm",
    "initial",
  ]);
  execFileSync("git", ["-C", repository, "worktree", "add", "-q", "-b", "test-worktree", worktree]);
  mkdirSync(path.join(worktree, "scripts"));
  copyFileSync(new URL("./devcontainer.sh", import.meta.url), path.join(worktree, "scripts/devcontainer.sh"));
  const bin = path.join(root, "bin");
  writeFileSync(path.join(bin, "npx"), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
  const result = spawnSync("bash", [path.join(worktree, "scripts/devcontainer.sh"), "up"], {
    encoding: "utf8",
    env: { PATH: `${bin}:${process.env.PATH}`, DEFAULT_OK: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`type=bind,source=${repository}/.git,target=${repository}/.git`));
});
