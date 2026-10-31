import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { findQualification, qualifies, readQualificationArchive } from "./ci-qualification.mjs";

const names = [
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
  "preflight",
  "check-tests",
  "build",
  "smoke",
  "recovery",
  "docs",
  "launch-registry",
];
function fixture() {
  const metadata = {
    source: {
      head: "a".repeat(40),
      tree: "b".repeat(40),
      dirty: false,
      sourceSha256: "c".repeat(64),
      lockfileSha256: "d".repeat(64),
    },
    tools: { node: "v22.23.4", pnpm: "10.28.0", git: "git version fixture" },
    runtime: {
      platform: "linux",
      architecture: "x64",
      ci: true,
      osSha256: "e".repeat(64),
      packagesSha256: "f".repeat(64),
    },
  };
  const report = {
    schemaVersion: 1,
    command: "all",
    pass: true,
    executed: true,
    reportWritten: true,
    metadata: structuredClone(metadata),
    steps: names.map((name) => ({ name, executed: true, pass: true, command: ["pnpm"], exitCode: 0, signal: null })),
  };
  const current = { command: "doctor", pass: true, reportWritten: true, metadata: structuredClone(metadata) };
  const run = {
    id: 12,
    run_attempt: 1,
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    workflow_id: 34,
    head_sha: "1".repeat(40),
    head_repository: { full_name: "owner/repo" },
  };
  const options = {
    current,
    repository: "owner/repo",
    runId: "56",
    token: "test-only",
    readReport: async () => report,
  };
  const data = {
    "/actions/runs/56": {
      event: "push",
      head_branch: "main",
      head_sha: metadata.source.head,
      head_repository: run.head_repository,
      workflow_id: 34,
    },
    "/actions/workflows/34/runs?event=pull_request&status=success&per_page=20": { workflow_runs: [run] },
    [`/git/commits/${run.head_sha}`]: { tree: { sha: metadata.source.tree } },
    "/actions/runs/12/artifacts": {
      artifacts: [
        {
          id: 78,
          name: "verification-12-1",
          expired: false,
          digest: `sha256:${createHash("sha256").update("zip-fixture").digest("hex")}`,
        },
      ],
    },
    "/actions/artifacts/78/zip": "zip-fixture",
    [`/git/commits/${metadata.source.head}`]: {
      sha: metadata.source.head,
      tree: { sha: metadata.source.tree },
      parents: [{ sha: run.head_sha }],
    },
  };
  options.fetchImpl = async (url) => {
    const key = url.replace("https://api.github.com/repos/owner/repo", "");
    if (!(key in data)) throw new Error("Unexpected request: " + key);
    return { ok: true, json: async () => structuredClone(data[key]), arrayBuffer: async () => Buffer.from(data[key]) };
  };
  return { current, report, run, options, data };
}

test("only a complete full qualification of the identical clean source and runtime can be reused", () => {
  const f = fixture();
  assert.equal(qualifies(f.report, f.current, f.run, 34, "owner/repo"), true);
  const mutations = [
    (f) => {
      f.report.command = "check";
    },
    (f) => {
      f.report.pass = false;
    },
    (f) => {
      f.report.reportWritten = false;
    },
    (f) => {
      f.current.pass = false;
    },
    (f) => {
      f.report.metadata.source.dirty = true;
    },
    (f) => {
      f.current.metadata.source.dirty = true;
    },
    (f) => {
      f.report.metadata.source.tree = "0".repeat(40);
    },
    (f) => {
      f.report.metadata.source.sourceSha256 = "0".repeat(64);
    },
    (f) => {
      f.report.metadata.source.lockfileSha256 = "0".repeat(64);
    },
    (f) => {
      f.report.metadata.tools.node = "v22.0.0";
    },
    (f) => {
      f.report.metadata.runtime.architecture = "arm64";
    },
    (f) => {
      f.report.metadata.runtime.packagesSha256 = "0".repeat(64);
    },
    (f) => {
      f.current.metadata.runtime = null;
    },
    (f) => {
      f.current.metadata.runtime.ci = false;
    },
    (f) => {
      f.report.steps.pop();
    },
    (f) => {
      f.report.steps[0].executed = false;
    },
    (f) => {
      f.report.steps[0].pass = false;
    },
    (f) => {
      f.report.steps[0].exitCode = 1;
    },
    (f) => {
      f.report.steps[0].signal = "SIGTERM";
    },
    (f) => {
      f.run.conclusion = "cancelled";
    },
    (f) => {
      f.run.event = "workflow_dispatch";
    },
    (f) => {
      f.run.workflow_id = 99;
    },
    (f) => {
      f.run.head_repository.full_name = "fork/repo";
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    assert.equal(qualifies(f.report, f.current, f.run, 34, "owner/repo"), false, mutate.toString());
  }
});

test("lookup verifies server-side run identity, artifact attempt and the actual tested merge commit", async () => {
  const f = fixture();
  const result = await findQualification(f.options);
  assert.equal(result.runId, 12);
  assert.equal(result.artifactId, 78);
  assert.equal(result.report, f.report);
});

test("missing, foreign, malformed, expired or unreachable evidence always falls back to fresh checks", async () => {
  const mutations = [
    (f) => {
      f.options.token = "";
    },
    (f) => {
      f.data["/actions/runs/56"].head_branch = "feature";
    },
    (f) => {
      f.data["/actions/runs/56"].head_sha = "0".repeat(40);
    },
    (f) => {
      f.data["/actions/runs/56"].head_repository = { full_name: "fork/repo" };
    },
    (f) => {
      f.data["/actions/runs/12/artifacts"].artifacts[0].expired = true;
    },
    (f) => {
      f.data["/actions/runs/12/artifacts"].artifacts[0].name = "verification-12-0";
    },
    (f) => {
      f.data["/actions/runs/12/artifacts"].artifacts[0].digest = "sha256:" + "0".repeat(64);
    },
    (f) => {
      f.options.readReport = async () => {
        throw new Error("Malformed zip");
      };
    },
    (f) => {
      f.options.readReport = async () => ({});
    },
    (f) => {
      f.data[`/git/commits/${f.report.metadata.source.head}`].parents = [];
    },
    (f) => {
      f.data[`/git/commits/${f.report.metadata.source.head}`].tree.sha = "0".repeat(40);
    },
    (f) => {
      f.options.fetchImpl = async () => {
        throw new Error("API unavailable");
      };
    },
    (f) => {
      f.options.fetchImpl = async () => ({ ok: false });
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    assert.equal(await findQualification(f.options), null, mutate.toString());
  }
});

test("real artifact ZIPs select the full receipt alongside setup diagnostics and reject missing or ambiguous qualification", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "kanbun-qualification-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archive = path.join(directory, "qualification.zip");
  const fixture = (name) => readFile(new URL(`./fixtures/${name}.zip`, import.meta.url));
  assert.deepEqual(await readQualificationArchive(await fixture("qualification"), archive), {
    command: "all",
    pass: true,
  });
  for (const name of ["diagnostics-only", "ambiguous-qualification"])
    await assert.rejects(readQualificationArchive(await fixture(name), archive), /Missing or ambiguous/);
  await assert.rejects(readQualificationArchive(Buffer.from("Invalid ZIP"), archive));
});
