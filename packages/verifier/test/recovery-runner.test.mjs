import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runWithRecoveryEvidence } from "../src/recovery.mjs";

const child = `
  import { mkdir, symlink, writeFile } from 'node:fs/promises';
  import path from 'node:path';
  const output = process.env.KANBUN_RECOVERY_ARTIFACTS;
  await writeFile('output-location.txt', output);
  await mkdir(path.join(output, 'test-results'), { recursive: true });
  await writeFile(path.join(output, 'test-results', 'trace.zip'), 'completed trace bytes');
  await mkdir(path.join(output, 'report', 'data', 'nested'), { recursive: true });
  await writeFile(path.join(output, 'report', 'data', 'nested', 'screenshot.png'), Uint8Array.from([0, 255, 13, 10, 128]));
  if (process.argv[2] === "symlink") await symlink(path.join(output, 'test-results', 'trace.zip'), path.join(output, 'report', 'linked-trace.zip'));
  if (process.argv[2] !== "partial") {
    await mkdir(path.join(output, 'report'), { recursive: true });
    await writeFile(path.join(output, 'report', 'index.html'), '<html>Retained browser report</html>');
    await writeFile(path.join(output, 'results.json'), JSON.stringify({
      suites: [], config: { outputDir: output },
      attachments: [{ path: path.join(output, 'test-results', 'trace.zip') }],
    }));
  }
  process.exit(Number(process.argv[1]));
`;

for (const exitCode of [0, 7]) {
  test(`exports complete reports and traces after child exit ${exitCode}, preserving its status`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kanbun-recovery-runner-test-"));
    const destination = path.join(root, "artifacts", "recovery");
    try {
      await mkdir(destination, { recursive: true });
      await writeFile(path.join(destination, "stale.txt"), "An older run is not current evidence");
      const code = await runWithRecoveryEvidence({
        command: process.execPath,
        args: ["--input-type=module", "-e", child, String(exitCode)],
        cwd: root,
        destination,
      });
      assert.equal(code, exitCode);
      const temporary = await readFile(path.join(root, "output-location.txt"), "utf8");
      assert.equal(path.dirname(temporary), tmpdir());
      assert.equal(temporary.startsWith(destination), false);
      await assert.rejects(stat(temporary), { code: "ENOENT" });
      await assert.rejects(stat(path.join(destination, "stale.txt")), { code: "ENOENT" });
      const results = JSON.parse(await readFile(path.join(destination, "results.json"), "utf8"));
      assert.equal(results.config.outputDir, destination);
      assert.equal(results.attachments[0].path, path.join(destination, "test-results", "trace.zip"));
      assert.equal(await readFile(results.attachments[0].path, "utf8"), "completed trace bytes");
      assert.match(await readFile(path.join(destination, "report", "index.html"), "utf8"), /Retained browser report/);
      assert.deepEqual(
        await readFile(path.join(destination, "report", "data", "nested", "screenshot.png")),
        Buffer.from([0, 255, 13, 10, 128]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("an incomplete report fails while retaining partial diagnostic artifacts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanbun-recovery-partial-test-"));
  const destination = path.join(root, "artifacts", "recovery");
  try {
    const code = await runWithRecoveryEvidence({
      command: process.execPath,
      args: ["--input-type=module", "-e", child, "0", "partial"],
      cwd: root,
      destination,
    });
    assert.notEqual(code, 0);
    assert.equal(await readFile(path.join(destination, "test-results", "trace.zip"), "utf8"), "completed trace bytes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unexpected symlink evidence fails export and preserves the local originals", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanbun-recovery-symlink-test-"));
  let temporary;
  try {
    const code = await runWithRecoveryEvidence({
      command: process.execPath,
      args: ["--input-type=module", "-e", child, "0", "symlink"],
      cwd: root,
      destination: path.join(root, "artifacts", "recovery"),
    });
    assert.notEqual(code, 0);
    temporary = await readFile(path.join(root, "output-location.txt"), "utf8");
    assert.equal(await readFile(path.join(temporary, "test-results", "trace.zip"), "utf8"), "completed trace bytes");
    await assert.rejects(stat(path.join(root, "artifacts", "recovery", "report", "linked-trace.zip")), {
      code: "ENOENT",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
});

test("artifact export failure is nonzero and keeps the container-local originals", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanbun-recovery-export-test-"));
  let temporary;
  try {
    const blocked = path.join(root, "not-a-directory");
    await writeFile(blocked, "This blocks the export destination");
    const code = await runWithRecoveryEvidence({
      command: process.execPath,
      args: ["--input-type=module", "-e", child, "0"],
      cwd: root,
      destination: path.join(blocked, "recovery"),
    });
    assert.notEqual(code, 0);
    temporary = await readFile(path.join(root, "output-location.txt"), "utf8");
    assert.equal(await readFile(path.join(temporary, "test-results", "trace.zip"), "utf8"), "completed trace bytes");
  } finally {
    await rm(root, { recursive: true, force: true });
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
});
