import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { linuxAutostart } from "../dist/autostart.js";

test("Linux startup is installed, removable, and never overwrites another entry", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanbun-startup-"));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = root;
  const file = path.join(root, "autostart", "ai.kanbun.desktop.desktop");
  try {
    await linuxAutostart(true, "/opt/Kanbun App/kanbun");
    assert.match(await readFile(file, "utf8"), /Exec="\/opt\/Kanbun App\/kanbun" --background/);
    await linuxAutostart(false, "/unused");
    await assert.rejects(readFile(file), { code: "ENOENT" });
    await writeFile(file, "another application");
    await assert.rejects(linuxAutostart(true, "/opt/kanbun"), /not managed/);
    await assert.rejects(linuxAutostart(false, "/opt/kanbun"), /not managed/);
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("collector reads paginated Codex history and never infers a live state", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanbun-collector-"));
  try {
    await mkdir(path.join(root, "bin"));
    await writeFile(
      path.join(root, "bin", "codex"),
      `#!/usr/bin/env node
let buffer = "";
process.stdin.on("data", (chunk) => { buffer += chunk; let lines = buffer.split("\\n"); buffer = lines.pop(); for (const line of lines) { const q = JSON.parse(line); if (q.id === 1) console.log(JSON.stringify({id: 1, result: {}})); if (q.method === "thread/list") console.log(JSON.stringify({id: q.id, result: {data: [{id: q.params.cursor ? "two" : "one", name: "Fixture", updatedAt: 10, status: {type: "active"}}], nextCursor: q.params.cursor ? null : "next"}})); } });
`,
      { mode: 0o755 },
    );
    const project = path.join(root, ".claude", "projects", "-tmp-fixture");
    await mkdir(project, { recursive: true });
    const sessionId = "12345678-1234-4123-8123-123456789abc";
    await writeFile(
      path.join(project, `${sessionId}.jsonl`),
      `${JSON.stringify({ type: "user", uuid: "12345678-1234-4123-8123-123456789abd", sessionId, timestamp: "2026-01-01T00:00:00.000Z", cwd: "/tmp/fixture", gitBranch: "main", message: { role: "user", content: "Fixture session" } })}\n`,
    );
    const moduleUrl = new URL("../dist/collector.js", import.meta.url).href;
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {collectSessions} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(await collectSessions()))`,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, HOME: root, PATH: `${path.join(root, "bin")}:${process.env.PATH}` },
        timeout: 20000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const found = JSON.parse(result.stdout);
    assert.deepEqual(
      found.sessions.filter((x) => x.provider === "codex").map((x) => [x.id, x.status]),
      [
        ["one", "unknown"],
        ["two", "unknown"],
      ],
    );
    const claude = found.sessions.find((x) => x.provider === "claude" && x.id === sessionId);
    assert.equal(claude?.status, "unknown");
    assert.deepEqual(found.errors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
