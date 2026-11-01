import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const script = path.resolve(".devcontainer/verify-lock.sh");

function start(lock, timeout, command) {
  const child = spawn("bash", [script, "bash", "-c", command], {
    env: { ...process.env, KANBUN_VERIFY_LOCK_PATH: lock, KANBUN_VERIFY_LOCK_TIMEOUT: String(timeout) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  return { child, done: new Promise((resolve) => child.on("close", (code) => resolve({ code, stderr }))) };
}

test("heavy verifier lock serializes, times out and releases on termination", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kanbun-lock-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const lock = path.join(dir, "lock");
  const ready = path.join(dir, "ready");
  const first = start(lock, 5, `touch '${ready}'; exec sleep 30`);
  t.after(() => first.child.kill("SIGKILL"));
  for (let i = 0; i < 100; i++) {
    try {
      await readFile(ready);
      break;
    } catch {
      if (i === 99) throw new Error("Lock holder did not start");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  const second = start(lock, 1, "exit 0");
  const blocked = await second.done;
  assert.equal(blocked.code, 75);
  assert.match(blocked.stderr, /waiting/);
  const cancelled = start(lock, 5, "exit 0");
  await new Promise((resolve) => setTimeout(resolve, 100));
  cancelled.child.kill("SIGTERM");
  assert.equal((await cancelled.done).code, 130);
  assert.equal((await start(lock, 0, "exit 0").done).code, 75);
  const queued = start(lock, 5, "exit 0");
  await new Promise((resolve) => setTimeout(resolve, 100));
  first.child.kill("SIGKILL");
  await first.done;
  const resumed = await queued.done;
  assert.equal(resumed.code, 0);
  assert.match(resumed.stderr, /waiting/);
  assert.equal((await start(lock, 1, "exit 0").done).code, 0);
});
