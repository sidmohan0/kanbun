import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { configureHooks, hookCommand } from "../dist/hook-setup.js";
import electronPath from "electron";
import { readHookStatuses } from "../dist/hook-store.js";

test("hook setup preserves existing provider hooks and removes only Kanbun handlers", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "kanbun-hooks-"));
  const spool = path.join(home, "kanbun-session-observer");
  try {
    await mkdir(path.join(home, ".claude"));
    const file = path.join(home, ".claude", "settings.json");
    await writeFile(
      file,
      JSON.stringify({ theme: "dark", hooks: { Stop: [{ hooks: [{ type: "command", command: "existing" }] }] } }),
    );
    await configureHooks("claude", true, "/electron", "/app/hook.js", spool, home);
    await configureHooks("claude", true, "/electron", "/app/hook.js", spool, home);
    let settings = JSON.parse(await readFile(file, "utf8"));
    assert.equal(settings.hooks.Stop.length, 2);
    assert.equal(settings.theme, "dark");
    await configureHooks("claude", false, "/electron", "/app/hook.js", spool, home);
    settings = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(settings.hooks.Stop, [{ hooks: [{ type: "command", command: "existing" }] }]);
    await configureHooks("codex", true, "/electron", "/app/hook.js", spool, home);
    assert.ok(JSON.parse(await readFile(path.join(home, ".codex", "hooks.json"), "utf8")).hooks.Interrupt);
    await writeFile(file, "{broken");
    await assert.rejects(configureHooks("claude", true, "/electron", "/app/hook.js", spool, home));
    assert.equal(await readFile(file, "utf8"), "{broken");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("real hook command stores only metadata and collector expires evidence", async () => {
  const spool = await mkdtemp(path.join(tmpdir(), "kanbun-session-observer-"));
  try {
    const result = spawnSync(process.execPath, [new URL("../dist/hook.js", import.meta.url).pathname, "codex", spool], {
      input: JSON.stringify({ session_id: "test-1", hook_event_name: "UserPromptSubmit", prompt: "private content" }),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    const now = Date.now();
    assert.equal((await readHookStatuses(spool, now)).get("codex:test-1"), "running");
    assert.equal((await readHookStatuses(spool, now + 300001)).get("codex:test-1"), "stale");
    const names = await (await import("node:fs/promises")).readdir(spool);
    assert.doesNotMatch(await readFile(path.join(spool, names[0]), "utf8"), /private content/);
    assert.equal((await readHookStatuses(spool, now + 86400001)).size, 0);
  } finally {
    await rm(spool, { recursive: true, force: true });
  }
});

test("configured command runs through the Electron binary", async () => {
  const spool = await mkdtemp(path.join(tmpdir(), "kanbun-session-observer-"));
  try {
    const script = new URL("../dist/hook.js", import.meta.url).pathname;
    const command = hookCommand("claude", electronPath, script, spool);
    const result = spawnSync(command, {
      shell: true,
      input: JSON.stringify({ session_id: "test-2", hook_event_name: "PermissionRequest" }),
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal((await readHookStatuses(spool)).get("claude:test-2"), "waiting");
  } finally {
    await rm(spool, { recursive: true, force: true });
  }
});
