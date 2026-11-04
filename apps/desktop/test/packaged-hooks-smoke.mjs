import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { configureHooks, hookCommand } from "../dist/hook-setup.js";
import { readHookStatuses } from "../dist/hook-store.js";

const executable = process.env.KANBUN_DESKTOP_EXECUTABLE;
assert.ok(executable, "KANBUN_DESKTOP_EXECUTABLE must point at the packaged Kanbun executable");

const resources =
  process.platform === "darwin"
    ? path.resolve(path.dirname(executable), "../Resources")
    : path.join(path.dirname(executable), "resources");
const script = path.join(resources, "app.asar", "dist/hook.js");
if (process.platform === "darwin") {
  const require = createRequire(import.meta.url);
  const builderEntry = require.resolve("electron-builder");
  const asar = require(require.resolve("@electron/asar", { paths: [builderEntry] }));
  const archive = path.join(resources, "app.asar");
  const packageJson = JSON.parse(asar.extractFile(archive, "package.json").toString());
  const mainSource = asar.extractFile(archive, packageJson.main).toString();
  assert.equal(packageJson.main, "dist/main.js");
  assert.match(mainSource, /kanbun-session-hook/u);
  console.log(`packaged main entry verified: ${packageJson.main}`);
}
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kanbun packaged observer "));
const home = path.join(temporaryRoot, "provider home with spaces");
const spool = path.join(temporaryRoot, "kanbun-session-observer with spaces");

try {
  await mkdir(home, { recursive: true });
  for (const provider of ["codex", "claude"]) {
    const directory = path.join(home, provider === "codex" ? ".codex" : ".claude");
    const filename = path.join(directory, provider === "codex" ? "hooks.json" : "settings.json");
    await mkdir(directory, { recursive: true });
    const existing = {
      providerSetting: "preserved",
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "user-owned-handler" }] }] },
    };
    await writeFile(filename, JSON.stringify(existing));
    await configureHooks(provider, true, executable, script, spool, home);
    const configured = JSON.parse(await readFile(filename, "utf8"));
    assert.equal(configured.providerSetting, "preserved");
    assert.ok(
      configured.hooks.SessionStart.some((group) => group.hooks?.some((hook) => hook.command === "user-owned-handler")),
    );

    const command = hookCommand(provider, executable, script, spool);
    const hookEnvironment = { ...process.env, KANBUN_HOOK_DIAGNOSTICS: "1", TMPDIR: temporaryRoot };
    if (process.platform === "darwin") delete hookEnvironment.ELECTRON_RUN_AS_NODE;
    else hookEnvironment.ELECTRON_RUN_AS_NODE = "1";
    const delivered = spawnSync(command, {
      shell: true,
      input: JSON.stringify({
        session_id: `packaged-${provider}`,
        hook_event_name: "UserPromptSubmit",
        prompt: "private fixture text",
      }),
      encoding: "utf8",
      timeout: 30000,
      env: hookEnvironment,
    });
    assert.equal(
      delivered.status,
      0,
      JSON.stringify({ error: delivered.error?.message, stdout: delivered.stdout, stderr: delivered.stderr }),
    );
    if (process.platform === "darwin") {
      assert.match(delivered.stderr, /stdin copied\n/u, delivered.stderr);
      assert.match(delivered.stderr, /app exited\n/u, delivered.stderr);
      assert.match(delivered.stderr, /dispatcher details:/u, delivered.stderr);
      assert.match(delivered.stderr, /"hookDispatch":true/u, delivered.stderr);
      assert.equal(
        (await (await import("node:fs/promises")).readdir(temporaryRoot)).some((name) =>
          name.startsWith("kanbun-session-hook."),
        ),
        false,
        "generated hook command removes its temporary FIFO directory",
      );
    }
    const statuses = await readHookStatuses(spool);
    assert.equal(statuses.get(`${provider}:packaged-${provider}`), "running");
    const names = await (await import("node:fs/promises")).readdir(spool);
    for (const name of names)
      assert.doesNotMatch(await readFile(path.join(spool, name), "utf8"), /private fixture text/);

    await configureHooks(provider, false, executable, script, spool, home);
    const cleaned = JSON.parse(await readFile(filename, "utf8"));
    assert.equal(cleaned.providerSetting, "preserved");
    assert.deepEqual(cleaned.hooks.SessionStart, [{ hooks: [{ type: "command", command: "user-owned-handler" }] }]);
    for (const event of [
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "PermissionRequest",
      "Stop",
      "SessionEnd",
      "Interrupt",
      "Notification",
      "PostToolUseFailure",
      "StopFailure",
    ]) {
      const handlers = cleaned.hooks[event] ?? [];
      assert.equal(
        handlers.some((group) => group.hooks?.some((hook) => String(hook.command).includes("kanbun-session-observer"))),
        false,
      );
    }
  }

  const moduleUrl = new URL("../dist/hook-store.js", import.meta.url).href;
  const restart = `
    import assert from "node:assert/strict";
    const { readHookStatuses } = await import(${JSON.stringify(moduleUrl)});
    const spool = process.env.KANBUN_SMOKE_SPOOL;
    const recent = await readHookStatuses(spool);
    assert.equal(recent.get("codex:packaged-codex"), "running");
    assert.equal(recent.get("claude:packaged-claude"), "running");
    const stale = await readHookStatuses(spool, Date.now() + 5 * 60 * 1000 + 1);
    assert.equal(stale.get("codex:packaged-codex"), "stale");
    assert.equal(stale.get("claude:packaged-claude"), "stale");
    console.log("fresh-process recovery and stale aging passed");
  `;
  const resumed = spawnSync(process.execPath, ["--input-type=module", "-e", restart], {
    encoding: "utf8",
    env: { ...process.env, KANBUN_SMOKE_SPOOL: spool },
    timeout: 15000,
  });
  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout || String(resumed.error));
  console.log("packaged hook invocation, metadata-only storage, and cleanup passed");
  console.log(resumed.stdout.trim());
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
