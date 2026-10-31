import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repositoryName, summarizeLeaks } from "./public-audit.mjs";

test("each pinned audit tool exposes its declared version interface", async () => {
  const pins = JSON.parse(await readFile(new URL("../config/audit-tools.json", import.meta.url), "utf8"));
  for (const [name, pin] of Object.entries(pins)) {
    const binary = existsSync(`/usr/local/bin/${name}`) ? `/usr/local/bin/${name}` : `/home/node/.local/bin/${name}`;
    const result = spawnSync(binary, pin.versionArgs, { encoding: "utf8" });
    assert.equal(result.status, 0, `${name} version command failed`);
    assert.ok(result.stdout.includes(pin.version), `${name} did not report the pinned version`);
  }
});

test("public secret findings omit the match, credential, and source text", () => {
  const findings = summarizeLeaks([
    {
      RuleID: "example",
      File: "config",
      StartLine: 3,
      Commit: "a".repeat(40),
      Secret: "private-credential",
      Match: "private-credential",
      Author: "private-person",
    },
  ]);
  assert.deepEqual(findings, [{ rule: "example", file: "config", line: 3, commit: "a".repeat(40) }]);
  assert.equal(JSON.stringify(findings).includes("private-"), false);
  assert.throws(() => summarizeLeaks({}), /findings array/);
});

test("repository assessment cannot accept endpoints outside the selected repository", () => {
  assert.equal(repositoryName("owner/repo"), "owner/repo");
  for (const value of [undefined, "", "owner/repo/../other", "https://example.com", "owner/repo?token=private"])
    assert.throws(() => repositoryName(value));
});

test("the pinned scanner allows the reviewed nonce but still rejects an unrelated credential", () => {
  const scanner = existsSync("/usr/local/bin/gitleaks") ? "/usr/local/bin/gitleaks" : "/home/node/.local/bin/gitleaks";
  const scan = (input) =>
    spawnSync(scanner, ["stdin", "--config=.gitleaks.toml", "--no-banner", "--redact=100"], {
      input,
      encoding: "utf8",
    });
  assert.equal(scan('"Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ=="').status, 0);
  const syntheticCredential = ["ghp", "_", "aB7cD9eF2gH4jK6mN8pQ1rS3tU5vW7xY9zA2"].join("");
  const result = scan(`token = "${syntheticCredential}"`);
  assert.equal(result.status, 1);
  assert.equal(`${result.stdout}${result.stderr}`.includes(syntheticCredential), false);
});

test("project writing rules reject promotional prose and ignore fenced code", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const directory = await mkdtemp(path.join(tmpdir(), "kanbun-writing-test-"));
  const binary = existsSync("/usr/local/bin/vale") ? "/usr/local/bin/vale" : "/home/node/.local/bin/vale";
  const target = path.join(directory, "README.md");
  const config = path.join(directory, ".vale.ini");
  await writeFile(
    config,
    (await readFile(path.join(root, ".vale.ini"), "utf8")).replace(
      /^StylesPath\s*=.*$/m,
      `StylesPath = ${path.join(root, "config/writing")}`,
    ),
  );
  try {
    const run = () =>
      spawnSync(binary, [`--config=${config}`, "--output=JSON", "README.md"], {
        cwd: directory,
        encoding: "utf8",
      });
    await writeFile(target, "A game-changing issue tracker.\n");
    const prose = run();
    assert.equal(prose.status, 1, `${prose.stdout}${prose.stderr}`);
    assert.match(prose.stdout, /Kanbun.Promotional/);
    await writeFile(target, "# Example\n\n```text\ngame-changing\n```\n");
    const fenced = run();
    assert.equal(fenced.status, 0, `${fenced.stdout}${fenced.stderr}`);
    assert.deepEqual(JSON.parse(fenced.stdout), {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
