import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const expectedCalls = [
  ["--version"],
  ["format:check"],
  ["lint"],
  ["typecheck"],
  ["test:scripts"],
  ["spec:check", "--initial"],
  ["test:recovery", "--preflight"],
  ["test"],
  ["build"],
  ["seed"],
  ["test:recovery", "--remaining"],
].map((args) => (args[0] === "--version" ? args : ["--reporter=append-only", ...args]));

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "kanbun-verifier-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (name, text) => {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), text);
  };
  write(
    "packages/verifier/package.json",
    JSON.stringify({
      name: "@kanbun/verifier",
      private: true,
      type: "module",
      scripts: { build: "echo 'source package'" },
    }),
  );
  cpSync(path.join(packageRoot, "src"), path.join(root, "packages/verifier/src"), { recursive: true });
  write("docs/launch/criteria.json", readFileSync(path.join(packageRoot, "../../docs/launch/criteria.json"), "utf8"));
  mkdirSync(path.join(root, "apps"));
  write(".nvmrc", process.version.slice(1) + "\n");
  write(".gitignore", "node_modules/\nartifacts/\n.pnpm-calls\n.pnpm-local-logs\n");
  write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  write("pnpm-workspace.yaml", "packages:\n  - apps/*\n  - packages/*\n");
  write(
    "package.json",
    JSON.stringify({
      name: "verifier-fixture",
      private: true,
      packageManager: "pnpm@10.28.0",
      dependencies: { "verifier-fixture-dependency": "1.0.0" },
    }),
  );
  write(
    "node_modules/verifier-fixture-dependency/package.json",
    JSON.stringify({ name: "verifier-fixture-dependency", version: "1.0.0", main: "index.js" }),
  );
  write("node_modules/verifier-fixture-dependency/index.js", "module.exports = {};\n");
  write(
    "packages/verifier/src/docs.mjs",
    'export function checkDocumentation() { return [{name:"fixture documentation",pass:true,details:"Checked"}]; }\n',
  );
  execFileSync("git", ["init", "-b", "main", root], { stdio: "ignore" });
  const bin = path.join(root, ".bin");
  mkdirSync(bin);
  symlinkSync(process.execPath, path.join(bin, "node"));
  symlinkSync(execFileSync("which", ["git"], { encoding: "utf8" }).trim(), path.join(bin, "git"));
  writeFileSync(
    path.join(bin, "pnpm"),
    `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const invocation=process.argv.slice(2);
fs.appendFileSync(".pnpm-calls",JSON.stringify(invocation)+"\\n");
fs.appendFileSync(".pnpm-local-logs",fs.readlinkSync("/proc/self/fd/1")+"\\n");
const args=invocation.filter(argument=>argument!=="--reporter=append-only");
if(args[0]==="--version")console.log(process.env.FIXTURE_PNPM_VERSION || "10.28.0");
else {
  console.log("stdout from "+args.join(" "));
  console.error("stderr from "+args.join(" "));
  if(args[0]==="build" && (process.env.FIXTURE_REMOVE_LOG || process.env.FIXTURE_BLOCK_REPORT)) {
    const run=path.dirname(fs.readlinkSync("/proc/self/fd/1"));
    if(process.env.FIXTURE_REMOVE_LOG)fs.unlinkSync(path.join(run,fs.readdirSync(run).find(name=>name.includes("-build.stdout.log"))));
    if(process.env.FIXTURE_BLOCK_REPORT)fs.writeFileSync(path.join(run,"report.json"),"occupied");
  }
  if(args[0]==="build" && process.env.FIXTURE_BLOCK_EXPORT) {
    const parent=path.resolve("artifacts/verification"),run=path.join(parent,fs.readdirSync(parent).at(-1));
    fs.rmSync(run,{recursive:true});fs.writeFileSync(run,"blocks exported artifacts");
  }
  if(process.env.FIXTURE_FAIL===args[0])process.exitCode=7;
}
`,
    { mode: 0o755 },
  );
  const run = (args = [], env = {}) => {
    const result = spawnSync(process.execPath, [path.join(root, "packages/verifier/src/cli.mjs"), ...args, "--json"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: bin, ...env },
    });
    assert.ok(
      result.stderr
        .split("\n")
        .filter(Boolean)
        .every((line) => line.startsWith("[verify] ")),
      result.stderr,
    );
    return { ...result, report: JSON.parse(result.stdout) };
  };
  const calls = () => readFileSync(path.join(root, ".pnpm-calls"), "utf8").trim().split("\n").map(JSON.parse);
  return { root, bin, write, run, calls };
}

test("all executes the required gates and emits one JSON receipt with retained logs", (t) => {
  const f = fixture(t);
  const { status, report, stderr } = f.run();
  assert.match(stderr, /\[verify\] START preflight/);
  assert.match(stderr, /\[verify\] PASS recovery \(\d+\.\d+s\)/);
  assert.equal(status, 0);
  assert.equal(report.pass, true);
  assert.equal(report.reportWritten, true);
  assert.ok(report.steps.length > 0);
  assert.ok(report.steps.every((step) => step.executed && step.pass));
  assert.deepEqual(f.calls(), expectedCalls);
  assert.deepEqual(JSON.parse(readFileSync(path.join(report.runDirectory, "report.json"), "utf8")), report);
  const build = report.steps.find((step) => step.name === "build");
  assert.equal(build.exitCode, 0);
  assert.match(readFileSync(build.stdoutLog, "utf8"), /stdout from build/);
  assert.match(readFileSync(build.stderrLog, "utf8"), /stderr from build/);
  const liveLogs = readFileSync(path.join(f.root, ".pnpm-local-logs"), "utf8").trim().split("\n");
  assert.ok(liveLogs.every((file) => file.startsWith(path.join(os.tmpdir(), "kanbun-verification-"))));
  assert.ok(liveLogs.every((file) => !file.startsWith(report.runDirectory)));
  assert.ok(
    report.steps
      .filter((step) => step.executed)
      .every(
        (step) =>
          path.dirname(step.stdoutLog) === report.runDirectory && path.dirname(step.stderrLog) === report.runDirectory,
      ),
  );
  assert.equal(report.metadata.source.head, null);
  assert.equal(report.metadata.source.branch, "main");
  assert.equal(report.metadata.source.dirty, true);
  assert.equal(report.metadata.tools.pnpm, "10.28.0");
  assert.equal(report.metadata.tools.node, process.version);
  assert.equal(
    report.metadata.source.lockfileSha256,
    createHash("sha256")
      .update(readFileSync(path.join(f.root, "pnpm-lock.yaml")))
      .digest("hex"),
  );
});

test("a silent pnpm parent preserves concurrent recursive diagnostics while emitting only JSON", (t) => {
  const f = fixture(t);
  const pnpm = process.env.npm_execpath?.includes("pnpm")
    ? process.env.npm_execpath
    : execFileSync("which", ["pnpm"], { encoding: "utf8" }).trim();
  writeFileSync(
    path.join(f.bin, "pnpm"),
    `#!/usr/bin/env node
import {spawnSync} from "node:child_process";
process.exitCode=spawnSync(${JSON.stringify(pnpm)},process.argv.slice(2),{stdio:"inherit"}).status ?? 1;
`,
    { mode: 0o755 },
  );
  const manifest = JSON.parse(readFileSync(path.join(f.root, "package.json"), "utf8"));
  manifest.scripts = {
    "verify-fixture": "node packages/verifier/src/cli.mjs build --json",
    build: "pnpm -r build",
  };
  f.write("package.json", JSON.stringify(manifest));
  for (const name of ["a", "b"]) {
    f.write(
      `packages/${name}/package.json`,
      JSON.stringify({ name: `diagnostic-fixture-${name}`, private: true, scripts: { build: "node build.mjs" } }),
    );
    f.write(
      `packages/${name}/build.mjs`,
      `console.log("recursive stdout ${name}"); console.error("recursive stderr ${name}");\n`,
    );
  }
  const result = spawnSync(pnpm, ["--silent", "verify-fixture"], {
    cwd: f.root,
    encoding: "utf8",
    env: { ...process.env, PATH: `${f.bin}${path.delimiter}${process.env.PATH}` },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /\[verify\] PASS build/);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, true);
  const build = report.steps.find((step) => step.name === "build");
  const diagnostics = readFileSync(build.stdoutLog, "utf8") + readFileSync(build.stderrLog, "utf8");
  for (const name of ["a", "b"]) {
    assert.match(diagnostics, new RegExp(`recursive stdout ${name}`));
    assert.match(diagnostics, new RegExp(`recursive stderr ${name}`));
  }
});

test("failed commands preserve their real exit code and prevent subsequent execution", (t) => {
  const f = fixture(t);
  const { status, report } = f.run(["all"], { FIXTURE_FAIL: "lint" });
  assert.equal(status, 1);
  assert.equal(report.pass, false);
  assert.equal(report.steps.find((step) => step.name === "check-lint").exitCode, 7);
  assert.ok(
    report.steps
      .filter((step) => ["build", "smoke", "docs"].includes(step.name))
      .every((step) => !step.executed && !step.pass),
  );
  assert.deepEqual(f.calls(), expectedCalls.slice(0, 3));
});

test("doctor enforces exact Node and pnpm pins and does not install tools", (t) => {
  const f = fixture(t);
  let result = f.run(["check"], { FIXTURE_PNPM_VERSION: "10.29.0" });
  assert.equal(result.status, 1);
  assert.equal(result.report.steps.find((step) => step.name === "doctor-pnpm").pass, false);
  assert.deepEqual(f.calls(), [["--version"]]);
  f.write(".nvmrc", "22.0.0\n");
  result = f.run(["doctor"]);
  assert.equal(result.status, 1);
  assert.equal(result.report.steps.find((step) => step.name === "doctor-node").pass, false);
});

test("missing installed workspace dependencies block the gate", (t) => {
  const f = fixture(t);
  rmSync(path.join(f.root, "node_modules"), { recursive: true });
  const { status, report } = f.run(["build"]);
  assert.equal(status, 1);
  assert.match(report.steps.find((step) => step.name === "doctor-dependencies").details, /verifier-fixture-dependency/);
  assert.equal(report.steps.find((step) => step.name === "build").executed, false);
});

test("an unavailable required tool cannot be recorded as executed or passing", (t) => {
  const f = fixture(t);
  rmSync(path.join(f.bin, "pnpm"));
  const { status, report } = f.run(["doctor"]);
  assert.equal(status, 1);
  const step = report.steps.find((step) => step.name === "doctor-pnpm");
  assert.equal(step.executed, false);
  assert.equal(step.pass, false);
  assert.equal(step.exitCode, null);
  assert.match(step.error, /ENOENT/);
});

test("missing command logs turn an otherwise successful command into a failure", (t) => {
  const f = fixture(t);
  const { status, report } = f.run(["build"], { FIXTURE_REMOVE_LOG: "1" });
  assert.equal(status, 1);
  const step = report.steps.find((step) => step.name === "build");
  assert.equal(step.exitCode, 0);
  assert.equal(step.pass, false);
  assert.match(step.error, /logs unavailable/);
});

test("a report write failure cannot produce a successful receipt", (t) => {
  const f = fixture(t);
  const { status, report } = f.run(["build"], { FIXTURE_BLOCK_REPORT: "1" });
  assert.equal(status, 1);
  assert.equal(report.pass, false);
  assert.equal(report.reportWritten, false);
  assert.match(report.error, /report could not be written/);
});

test("invalid output destinations fail without pretending any commands ran", (t) => {
  const f = fixture(t);
  f.write("occupied", "file\n");
  const { status, report } = f.run(["doctor", "--output", path.join(f.root, "occupied")]);
  assert.equal(status, 1);
  assert.equal(report.pass, false);
  assert.equal(report.executed, false);
  assert.equal(report.reportWritten, false);
});

test("completed logs and receipt respect a custom output directory", (t) => {
  const f = fixture(t);
  const output = path.join(f.root, "custom-receipts");
  const { status, report } = f.run(["doctor", "--output", output]);
  assert.equal(status, 0);
  assert.equal(path.dirname(report.runDirectory), output);
  assert.deepEqual(JSON.parse(readFileSync(path.join(report.runDirectory, "report.json"), "utf8")), report);
  assert.ok(report.steps.every((step) => readFileSync(step.stdoutLog) && readFileSync(step.stderrLog)));
  assert.ok(Object.keys(report.metadata.source.files).every((file) => !file.startsWith("custom-receipts/")));
});

test("an export failure fails verification and retains a valid container-local recovery receipt", (t) => {
  const f = fixture(t);
  const { status, report } = f.run(["build"], { FIXTURE_BLOCK_EXPORT: "1" });
  assert.equal(status, 1);
  assert.equal(report.pass, false);
  assert.match(report.error, /artifacts could not be exported/);
  assert.equal(report.reportWritten, true);
  assert.equal(report.runDirectory, report.recoveryDirectory);
  t.after(() => rmSync(report.recoveryDirectory, { recursive: true, force: true }));
  assert.ok(report.runDirectory.startsWith(path.join(os.tmpdir(), "kanbun-verification-")));
  assert.deepEqual(JSON.parse(readFileSync(path.join(report.runDirectory, "report.json"), "utf8")), report);
  const build = report.steps.find((step) => step.name === "build");
  assert.equal(build.pass, true);
  assert.equal(path.dirname(build.stdoutLog), report.runDirectory);
  assert.match(readFileSync(build.stdoutLog, "utf8"), /stdout from build/);
});

test("successive runs have distinct retained report directories", (t) => {
  const f = fixture(t);
  const first = f.run(["doctor"]);
  const second = f.run(["doctor"]);
  assert.equal(first.status, 0);
  assert.equal(second.status, 0);
  assert.notEqual(first.report.runDirectory, second.report.runDirectory);
  assert.ok(readFileSync(path.join(first.report.runDirectory, "report.json")));
});

test("empty documentation results and unknown profiles cannot pass", (t) => {
  const f = fixture(t);
  f.write("packages/verifier/src/docs.mjs", "export function checkDocumentation() { return []; }\n");
  const docs = f.run(["docs"]);
  assert.equal(docs.status, 1);
  assert.match(docs.report.steps.find((step) => step.name === "docs").error, /empty or malformed/);
  const unknown = f.run(["unknown"]);
  assert.equal(unknown.status, 1);
  assert.equal(unknown.report.pass, false);
});

test("preflight is independently runnable and missing dependencies do not block Node-only documentation", (t) => {
  const f = fixture(t);
  const preflight = f.run(["preflight"]);
  assert.equal(preflight.status, 0);
  assert.deepEqual(f.calls(), [["--version"], ["--reporter=append-only", "test:recovery", "--preflight"]]);
  rmSync(path.join(f.root, "node_modules"), { recursive: true });
  const docs = f.run(["docs"]);
  assert.equal(docs.status, 0);
  assert.equal(
    docs.report.steps.some((step) => step.name === "doctor-dependencies"),
    false,
  );
});

test("a failed browser preflight stops before bulk package tests, build and remaining recovery", (t) => {
  const f = fixture(t);
  const { status, report, stderr } = f.run(["all"], { FIXTURE_FAIL: "test:recovery" });
  assert.equal(status, 1);
  assert.match(stderr, /\[verify\] FAIL preflight/);
  assert.equal(report.steps.find((step) => step.name === "preflight").exitCode, 7);
  assert.ok(
    report.steps
      .filter((step) => ["check-tests", "build", "smoke", "recovery"].includes(step.name))
      .every((step) => !step.executed && !step.pass),
  );
  assert.deepEqual(f.calls(), expectedCalls.slice(0, 7));
});

test("launch reports unmet public-release evidence without making ordinary verification fail", (t) => {
  const f = fixture(t);
  const ordinary = f.run(["all"]);
  assert.equal(ordinary.status, 0);
  assert.equal(ordinary.report.steps.find((step) => step.name === "launch-registry").pass, true);
  const launch = f.run(["launch"]);
  assert.equal(launch.status, 1);
  const result = launch.report.steps.find((step) => step.name === "launch").launch;
  assert.equal(result.pass, false);
  assert.equal(result.requirements.length, 11);
  assert.ok(
    result.requirements
      .flatMap((item) => item.criteria)
      .some((item) => item.status === "pending-review" || item.status === "failed"),
  );
  const misplaced = f.run(["doctor", "--evidence", "missing.json"]);
  assert.equal(misplaced.status, 1);
  assert.match(misplaced.report.error, /only by the launch/);
  const readable = spawnSync(process.execPath, [path.join(f.root, "packages/verifier/src/cli.mjs"), "launch"], {
    cwd: f.root,
    encoding: "utf8",
    env: { ...process.env, PATH: f.bin },
  });
  assert.equal(readable.status, 1);
  assert.match(readable.stdout, /OPEN PUB-01/);
  assert.match(readable.stdout, /PUB-01\.01: Required audit evidence has not been supplied/);
});
