import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  collectLaunchEvidence,
  evaluateLaunchReadiness,
  fingerprintCriterion,
  validateLaunchRegistry,
} from "../src/launch.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const ids = [
  "PUB-01",
  "PUB-02",
  "PUB-03",
  "RUN-01",
  "RUN-02",
  "OPS-01",
  "DOC-01",
  "GOV-01",
  "BIZ-01",
  "PORT-01",
  "REL-01",
];
const criterionCounts = [2, 2, 1, 3, 2, 2, 3, 2, 1, 2, 2];
const suite = [
  "doctor-node",
  "doctor-pnpm",
  "doctor-git",
  "doctor-dependencies",
  "source-metadata",
  "check-format",
  "check-lint",
  "check-types",
  "check-script-tests",
  "check-spec-lock",
  "launch-registry",
  "preflight",
  "check-tests",
  "build",
  "smoke",
  "recovery",
  "docs",
];

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "kanbun-launch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, body) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), body);
  };
  write("subject.md", "Reviewed subject\n");
  write(".nvmrc", "22.23.4\n");
  write("package.json", JSON.stringify({ packageManager: "pnpm@10.28.0" }));
  const source = {
    sourceSha256: hash("source"),
    files: { "subject.md": hash(readFileSync(path.join(root, "subject.md"))) },
  };
  const registry = {
    schemaVersion: 1,
    requirements: ids.map((id, index) => ({
      id,
      title: `Requirement ${id}`,
      priority: 0,
      criteria: Array.from({ length: criterionCounts[index] }, (_, criterionIndex) => ({
        id: `${id}.${String(criterionIndex + 1).padStart(2, "0")}`,
        assertion: "A specific reviewed claim",
        owner: "Maintainer",
        procedure: "Inspect the scoped subject",
        method: "review",
        scope: ["subject.md"],
      })),
    })),
  };
  const criterion = (id) => registry.requirements.find((item) => item.id === id).criteria[0];
  const evidence = { schemaVersion: 1, entries: [] };
  function record(item, overrides = {}) {
    const artifact = `artifacts/${item.id}.md`;
    write(artifact, "Inspection procedure and conclusion\n");
    return {
      criterion: item.id,
      kind: item.method,
      status: "passed",
      ...fingerprintCriterion(item, source),
      performedBy: "Named reviewer",
      performedAt: "2026-10-31T12:00:00Z",
      environment: "Isolated fixture",
      procedure: item.procedure,
      conclusion: "The scoped claim was inspected and satisfied.",
      artifacts: [{ path: artifact, sha256: hash(readFileSync(path.join(root, artifact))) }],
      ...overrides,
    };
  }
  const run = () => evaluateLaunchReadiness({ root, source, registry, evidence });
  const find = (report, id, criterionId = `${id}.01`) =>
    report.requirements.find((item) => item.id === id).criteria.find((item) => item.id === criterionId);
  return { root, write, source, registry, criterion, evidence, record, run, find };
}

test("required launch IDs, methods, scopes and unique criteria are validated", (t) => {
  const f = fixture(t);
  assert.deepEqual(validateLaunchRegistry(f.registry), []);
  f.criterion("PUB-01").method = "trust-me";
  f.criterion("PUB-02").scope = ["../outside"];
  f.registry.requirements.push({ ...f.registry.requirements[0], criteria: [] });
  f.registry.requirements[0].criteria.pop();
  const errors = validateLaunchRegistry(f.registry).join("\n");
  assert.match(errors, /unknown verification method/);
  assert.match(errors, /repository-relative/);
  assert.match(errors, /exactly once/);
  assert.match(errors, /Required launch acceptance criterion is missing: PUB-01\.02/);
});

test("missing review, rehearsal and verifier evidence never passes", async (t) => {
  const f = fixture(t);
  f.criterion("RUN-01").method = "rehearsal";
  f.criterion("REL-01").method = "verifier";
  const report = await f.run();
  assert.equal(report.pass, false);
  assert.equal(f.find(report, "PUB-01").status, "pending-review");
  assert.equal(f.find(report, "RUN-01").status, "blocked");
  assert.equal(f.find(report, "REL-01").status, "not-run");
});

test("review conclusions are explicit attestations with versioned scope", async (t) => {
  const f = fixture(t);
  f.evidence.entries = f.registry.requirements.flatMap((item) => item.criteria.map((criterion) => f.record(criterion)));
  assert.equal((await f.run()).pass, true);
  f.source.files["unrelated.md"] = hash("new unrelated material");
  assert.equal((await f.run()).pass, true);
  f.source.files["subject.md"] = hash("changed subject");
  let result = await f.run();
  assert.equal(result.pass, false);
  assert.match(f.find(result, "PUB-01").details, /stale/);
  f.source.files["subject.md"] = hash(readFileSync(path.join(f.root, "subject.md")));
  f.criterion("PUB-01").assertion = "A stronger claim";
  result = await f.run();
  assert.equal(f.find(result, "PUB-01").status, "failed");
});

test("whole-tree scopes invalidate evidence when source is added or removed", async (t) => {
  const f = fixture(t);
  const criterion = f.criterion("PUB-01");
  criterion.scope = ["."];
  f.evidence.entries.push(f.record(criterion));
  assert.equal(f.find(await f.run(), "PUB-01").status, "passed");
  f.source.files["new-credential-file"] = hash("new source");
  assert.match(f.find(await f.run(), "PUB-01").details, /stale/);
});

test("unknown, duplicate, wrong-kind and malformed records fail closed", async (t) => {
  const f = fixture(t);
  f.evidence.entries = [f.record(f.criterion("PUB-01"), { kind: "rehearsal" })];
  assert.match(f.find(await f.run(), "PUB-01").details, /incompatible/);
  f.evidence.entries = [f.record(f.criterion("PUB-01"), { performedBy: "" })];
  assert.match(f.find(await f.run(), "PUB-01").details, /producer/);
  f.evidence.entries = [f.record(f.criterion("PUB-01")), f.record(f.criterion("PUB-01"))];
  assert.match(f.find(await f.run(), "PUB-01").details, /Ambiguous/);
  f.evidence.entries = [f.record(f.criterion("PUB-01"), { criterion: "PUB-99.99" })];
  assert.match((await f.run()).errors.join(), /unknown criterion/);
});

test("changed, missing and escaping artifacts cannot satisfy a criterion", async (t) => {
  const f = fixture(t);
  const entry = f.record(f.criterion("PUB-01"));
  f.evidence.entries = [entry];
  f.write(entry.artifacts[0].path, "tampered");
  assert.match(f.find(await f.run(), "PUB-01").details, /content changed/);
  entry.artifacts[0].path = "../outside.md";
  assert.match(f.find(await f.run(), "PUB-01").details, /repository-relative/);
  entry.artifacts[0].path = "artifacts/missing.md";
  assert.equal(f.find(await f.run(), "PUB-01").status, "failed");
  const outside = path.join(tmpdir(), `kanbun-outside-${path.basename(f.root)}`);
  writeFileSync(outside, "outside");
  t.after(() => rmSync(outside, { force: true }));
  symlinkSync(outside, path.join(f.root, "artifacts/link.md"));
  entry.artifacts = [{ path: "artifacts/link.md", sha256: hash("outside") }];
  assert.match(f.find(await f.run(), "PUB-01").details, /inside the repository/);
});

test("file checks establish presence only and missing source is reported", async (t) => {
  const f = fixture(t);
  const criterion = f.criterion("PUB-01");
  criterion.method = "files";
  criterion.files = ["subject.md"];
  assert.equal(f.find(await f.run(), "PUB-01").status, "passed");
  criterion.files = ["missing.md"];
  assert.equal(f.find(await f.run(), "PUB-01").status, "failed");
  criterion.scope = ["missing/"];
  assert.match(f.find(await f.run(), "PUB-01").details, /Missing scoped/);
});

test("full verification requires matching source, complete executed suite and bound logs", async (t) => {
  const f = fixture(t);
  const criterion = f.criterion("REL-01");
  criterion.method = "verifier";
  const artifacts = [];
  const steps = suite.map((name) => {
    const step = { name, executed: true, pass: true };
    for (const field of ["stdoutLog", "stderrLog"]) {
      const file = `artifacts/full/${name}.${field}.log`;
      f.write(file, `result ${name}`);
      step[field] = path.join(f.root, file);
      artifacts.push({ path: file, sha256: hash(`result ${name}`) });
    }
    return step;
  });
  const receiptPath = "artifacts/full/report.json";
  const receipt = {
    schemaVersion: 1,
    command: "all",
    executed: true,
    pass: true,
    reportWritten: true,
    runDirectory: path.join(f.root, "artifacts/full"),
    metadata: {
      source: f.source,
      runtime: { platform: "linux", architecture: "arm64", osSha256: hash("linux"), packagesSha256: hash("packages") },
      tools: { node: "v22.23.4", pathNode: "v22.23.4", pnpm: "10.28.0" },
    },
    steps,
  };
  const save = () => {
    f.write(receiptPath, JSON.stringify(receipt));
    f.evidence.entries = [
      f.record(criterion, {
        receipt: receiptPath,
        artifacts: [...artifacts, { path: receiptPath, sha256: hash(JSON.stringify(receipt)) }],
      }),
    ];
  };
  save();
  assert.equal(f.find(await f.run(), "REL-01").status, "passed");
  receipt.metadata.runtime.platform = "darwin";
  save();
  assert.match(f.find(await f.run(), "REL-01").details, /Linux devcontainer/);
  receipt.metadata.runtime.platform = "linux";
  receipt.metadata.tools.pnpm = "99.0.0";
  save();
  assert.match(f.find(await f.run(), "REL-01").details, /pinned Node and pnpm/);
  receipt.metadata.tools.pnpm = "10.28.0";
  receipt.command = "doctor";
  save();
  assert.match(f.find(await f.run(), "REL-01").details, /full-verifier receipt/);
  receipt.command = "all";
  steps[0].executed = false;
  save();
  assert.match(f.find(await f.run(), "REL-01").details, /did not pass/);
  steps[0].executed = true;
  receipt.steps = steps.slice(1);
  save();
  assert.match(f.find(await f.run(), "REL-01").details, /incomplete/);
  receipt.steps = steps;
  save();
  f.evidence.entries[0].artifacts = f.evidence.entries[0].artifacts.slice(1);
  assert.match(f.find(await f.run(), "REL-01").details, /Unbound verifier log/);
  save();
  f.source.sourceSha256 = hash("changed source");
  assert.match(f.find(await f.run(), "REL-01").details, /current source fingerprint/);
});

test("audit collection requires a real matching receipt with pinned tools and named checks", async (t) => {
  const f = fixture(t);
  const criterion = f.criterion("DOC-01");
  criterion.method = "audit";
  criterion.auditKind = "prose";
  f.write("config/audit-tools.json", JSON.stringify({ vale: { version: "3.25.1" } }));
  const receipt = {
    schemaVersion: 1,
    kind: "prose",
    source: { ...f.source },
    performedAt: "2026-10-31T12:00:00Z",
    pass: true,
    status: "passed",
    tools: { vale: "3.25.1" },
    checks: [{ name: "writing-rules", pass: true }],
  };
  const save = () => {
    f.write("artifacts/launch/prose/report.json", JSON.stringify(receipt));
    f.evidence.entries = collectLaunchEvidence({ root: f.root, source: f.source, registry: f.registry }).entries;
  };
  assert.equal(f.find(await f.run(), "DOC-01").status, "not-run");
  save();
  assert.equal(f.find(await f.run(), "DOC-01").status, "passed");
  receipt.checks = [];
  save();
  assert.match(f.find(await f.run(), "DOC-01").details, /required executed checks/);
  receipt.checks = [{ name: "writing-rules", pass: true }];
  receipt.tools.vale = "unreviewed version";
  save();
  assert.match(f.find(await f.run(), "DOC-01").details, /pinned tool/);
  receipt.tools.vale = "3.25.1";
  receipt.source.sourceSha256 = hash("old source");
  save();
  assert.match(f.find(await f.run(), "DOC-01").details, /incompatible/);
});

test("collected local rehearsal requires all operation receipts and matching clean commit", async (t) => {
  const f = fixture(t);
  const criterion = f.registry.requirements.find((item) => item.id === "RUN-01").criteria[1];
  criterion.method = "rehearsal";
  f.source.head = "a".repeat(40);
  f.source.dirty = false;
  for (const operation of ["create", "restart", "rebuild", "reset-verified"])
    f.write(
      `artifacts/launch/local/${operation}.json`,
      JSON.stringify({
        operation,
        pass: true,
        root: "/isolated/clone",
        runId: "kanbun-install.fixture",
        sourceCommit: f.source.head,
        performedAt: "2026-10-31T12:00:00Z",
      }),
    );
  f.write("artifacts/launch/local/source-commit.txt", f.source.head);
  f.write(
    "artifacts/launch/local/expected.json",
    JSON.stringify({ title: "Fixture", runId: "kanbun-install.fixture", sourceCommit: f.source.head }),
  );
  f.write("artifacts/launch/local/lifecycle.log", "Actual clone lifecycle log");
  const collect = () => {
    f.evidence.entries = collectLaunchEvidence({ root: f.root, source: f.source, registry: f.registry }).entries;
  };
  collect();
  assert.equal(f.find(await f.run(), "RUN-01", "RUN-01.02").status, "passed");
  f.source.dirty = true;
  assert.match(f.find(await f.run(), "RUN-01", "RUN-01.02").details, /Clean committed source/);
  f.source.dirty = false;
  f.write("artifacts/launch/local/source-commit.txt", "b".repeat(40));
  collect();
  assert.match(f.find(await f.run(), "RUN-01", "RUN-01.02").details, /current committed source/);
  f.write("artifacts/launch/local/source-commit.txt", f.source.head);
  f.write(
    "artifacts/launch/local/rebuild.json",
    JSON.stringify({
      operation: "rebuild",
      pass: true,
      root: "/isolated/clone",
      runId: "kanbun-install.other",
      sourceCommit: f.source.head,
      performedAt: "2026-10-31T12:00:00Z",
    }),
  );
  collect();
  assert.match(f.find(await f.run(), "RUN-01", "RUN-01.02").details, /mixes different rehearsal runs/);
  f.write("artifacts/launch/local/rebuild.json", JSON.stringify({ operation: "rebuild", pass: false }));
  collect();
  assert.match(f.find(await f.run(), "RUN-01", "RUN-01.02").details, /did not pass/);
});

test("secret audit binds both named scans and the complete current reachable ref inventory", async (t) => {
  const f = fixture(t);
  const git = (...args) =>
    execFileSync("git", args, { cwd: f.root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main");
  git("add", "subject.md", ".nvmrc", "package.json");
  git("-c", "user.name=Launch test", "-c", "user.email=launch@example.com", "commit", "-m", "fixture");
  f.source.head = git("rev-parse", "HEAD");
  const criterion = f.criterion("PUB-01");
  criterion.method = "audit";
  criterion.auditKind = "secrets";
  f.write("config/audit-tools.json", JSON.stringify({ gitleaks: { version: "8.30.1" } }));
  const receipt = {
    schemaVersion: 1,
    kind: "secrets",
    source: f.source,
    performedAt: "2026-10-31T12:00:00Z",
    pass: true,
    status: "passed",
    tools: { gitleaks: "8.30.1" },
    checks: [
      { name: "history", pass: true },
      { name: "current-tree", pass: true },
    ],
    historyTip: f.source.head,
    historyRefsSha256: hash(git("show-ref", "--head").split("\n").filter(Boolean).sort().join("\n")),
  };
  f.write("artifacts/launch/secrets/report.json", JSON.stringify(receipt));
  f.evidence.entries = collectLaunchEvidence({ root: f.root, source: f.source, registry: f.registry }).entries;
  assert.equal(f.find(await f.run(), "PUB-01").status, "passed");
  git("branch", "additional-history", "HEAD");
  assert.match(f.find(await f.run(), "PUB-01").details, /reachable ref inventory/);
});
