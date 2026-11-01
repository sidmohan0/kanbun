import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));

test("the full-verifier worker budget overrides the worker CI configuration", (t) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "kanbun-vitest-budget-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  mkdirSync(path.join(fixture, "test"));
  symlinkSync(path.join(root, "apps/worker/node_modules"), path.join(fixture, "node_modules"));
  writeFileSync(path.join(fixture, "package.json"), '{"type":"module"}\n');
  for (const name of ["first", "second"]) {
    writeFileSync(
      path.join(fixture, "test", `${name}.test.ts`),
      `import { test } from "vitest";
import { appendFileSync } from "node:fs";
test("${name}", async () => {
  appendFileSync(process.env.KANBUN_BUDGET_TRACE!, "start ${name}\\n");
  await new Promise((resolve) => setTimeout(resolve, 300));
  appendFileSync(process.env.KANBUN_BUDGET_TRACE!, "end ${name}\\n");
});\n`,
    );
  }
  const trace = path.join(fixture, "events");
  const result = spawnSync(
    "pnpm",
    [
      "--filter",
      "@kanbun/worker",
      "exec",
      "vitest",
      "run",
      "--root",
      fixture,
      "--config",
      path.join(root, "apps/worker/vitest.config.ts"),
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, CI: "true", VITEST_MAX_WORKERS: "1", KANBUN_BUDGET_TRACE: trace },
    },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error ?? ""}`);
  const events = readFileSync(trace, "utf8").trim().split("\n");
  assert.equal(events.length, 4);
  assert.match(events[0], /^start /);
  assert.equal(events[1], events[0].replace("start ", "end "));
  assert.match(events[2], /^start /);
  assert.equal(events[3], events[2].replace("start ", "end "));
});
