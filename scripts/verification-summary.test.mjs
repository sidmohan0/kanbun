import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verificationSummary } from "./verification-summary.mjs";

test("summarizes a complete full receipt and handles incomplete runs", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kanbun-summary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.match(await verificationSummary(path.join(root, "missing")), /No verifier receipt/);
  await mkdir(path.join(root, "run-a"));
  await writeFile(path.join(root, "run-a", "report.json"), "invalid");
  assert.match(await verificationSummary(root), /No complete verifier receipt/);
  await mkdir(path.join(root, "run-b"));
  await writeFile(
    path.join(root, "run-b", "report.json"),
    JSON.stringify({
      command: "all",
      pass: false,
      startedAt: "2026-01-01",
      steps: [
        { name: "check|lint", executed: true, pass: false, durationMs: 1200 },
        { name: "build", executed: false, pass: false, durationMs: 0 },
      ],
    }),
  );
  const summary = await verificationSummary(root);
  assert.match(summary, /check lint \| Failed \| 1.2/);
  assert.match(summary, /build \| Skipped \| 0.0/);
});
