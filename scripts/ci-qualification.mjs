import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runVerification } from "../packages/verifier/src/index.mjs";

const sha = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;
const required = [
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
];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A prior full run qualifies only the identical clean tree, source, toolchain and Linux runtime inventory. */
export function qualifies(report, current, run, workflowId, repository) {
  const source = report?.metadata?.source;
  const now = current?.metadata?.source;
  const runtime = current?.metadata?.runtime;
  return Boolean(
    run?.event === "pull_request" &&
    run.status === "completed" &&
    run.conclusion === "success" &&
    run.workflow_id === workflowId &&
    run.head_repository?.full_name === repository &&
    report?.schemaVersion === 1 &&
    report.command === "all" &&
    report.pass === true &&
    report.executed === true &&
    report.reportWritten === true &&
    current?.pass === true &&
    current.command === "doctor" &&
    current.reportWritten === true &&
    source?.dirty === false &&
    now?.dirty === false &&
    sha.test(source.head) &&
    sha.test(now.head) &&
    sha.test(now.tree) &&
    source.tree === now.tree &&
    digest.test(now.sourceSha256) &&
    source.sourceSha256 === now.sourceSha256 &&
    digest.test(now.lockfileSha256) &&
    source.lockfileSha256 === now.lockfileSha256 &&
    same(report.metadata.tools, current.metadata.tools) &&
    runtime?.platform === "linux" &&
    runtime.ci === true &&
    ["arm64", "x64"].includes(runtime.architecture) &&
    digest.test(runtime.osSha256) &&
    digest.test(runtime.packagesSha256) &&
    same(report.metadata.runtime, runtime) &&
    Array.isArray(report.steps) &&
    same(
      report.steps.map((step) => step.name),
      required,
    ) &&
    report.steps.every(
      (step) =>
        step.executed === true &&
        step.pass === true &&
        !step.signal &&
        !step.error &&
        (step.command === null ? step.exitCode === null : step.exitCode === 0),
    ),
  );
}

/** Read-only Actions lookup. Any lookup/provenance problem falls back to fresh verification. */
export async function findQualification({ current, repository, runId, token, fetchImpl = fetch, readReport }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") || !/^\d+$/.test(runId ?? "") || !token) return null;
  const api = async (suffix, binary = false) => {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}${suffix}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error("Qualification evidence unavailable");
    if (!binary) return response.json();
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 50 * 1024 * 1024) throw new Error("Qualification evidence is too large");
    return bytes;
  };
  try {
    const executing = await api(`/actions/runs/${runId}`);
    if (
      executing.event !== "push" ||
      executing.head_branch !== "main" ||
      executing.head_sha !== current.metadata.source.head ||
      executing.head_repository?.full_name !== repository
    )
      return null;
    const { workflow_runs: runs } = await api(
      `/actions/workflows/${executing.workflow_id}/runs?event=pull_request&status=success&per_page=20`,
    );
    for (const run of runs) {
      if (run.head_repository?.full_name !== repository || !sha.test(run.head_sha ?? "")) continue;
      try {
        // This conservative shortcut may miss a valid merge candidate; falling back is safe.
        const head = await api(`/git/commits/${run.head_sha}`);
        if (head.tree?.sha !== current.metadata.source.tree) continue;
        const { artifacts } = await api(`/actions/runs/${run.id}/artifacts`);
        const artifact = artifacts.find(
          (item) => !item.expired && item.name === `verification-${run.id}-${run.run_attempt}`,
        );
        if (!artifact) continue;
        const bytes = await api(`/actions/artifacts/${artifact.id}/zip`, true);
        if (artifact.digest !== `sha256:${createHash("sha256").update(bytes).digest("hex")}`) continue;
        const report = await readReport(bytes);
        if (!qualifies(report, current, run, executing.workflow_id, repository)) continue;
        const tested = await api(`/git/commits/${report.metadata.source.head}`);
        if (
          tested.tree?.sha !== current.metadata.source.tree ||
          !(tested.sha === run.head_sha || tested.parents?.some((parent) => parent.sha === run.head_sha))
        )
          continue;
        return { runId: run.id, runAttempt: run.run_attempt, artifactId: artifact.id, report, bytes };
      } catch {
        // Missing, expired, malformed or mismatched evidence is never a passing result.
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function main() {
  const root = process.cwd();
  const output = path.join(root, "artifacts/verification");
  const progress = ({ name, state, durationMs }) =>
    console.error(
      `[verify] ${state.toUpperCase()} ${name}${durationMs === undefined ? "" : ` (${(durationMs / 1000).toFixed(1)}s)`}`,
    );
  if (process.env.GITHUB_EVENT_NAME === "push" && process.env.GITHUB_REF === "refs/heads/main") {
    const current = await runVerification({ root, command: "doctor", onProgress: progress });
    if (!current.pass) {
      console.log(JSON.stringify(current));
      process.exitCode = 1;
      return;
    }
    const archive = path.join(output, "qualification.zip");
    const qualification = await findQualification({
      current,
      repository: process.env.GITHUB_REPOSITORY,
      runId: process.env.GITHUB_RUN_ID,
      token: process.env.GITHUB_TOKEN,
      readReport: async (bytes) => {
        await writeFile(archive, bytes);
        const entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).split("\n");
        const reports = entries.filter((entry) => /^run-[\w-]+\/report.json$/.test(entry));
        if (reports.length !== 1) throw new Error("Ambiguous qualification receipt");
        return JSON.parse(
          execFileSync("unzip", ["-p", archive, reports[0]], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }),
        );
      },
    });
    if (qualification) {
      // Produce fresh build artifacts even when tests qualify by identity (including desktop bundles).
      const build = await runVerification({ root, command: "build", onProgress: progress });
      const receipt = {
        mode: "reused",
        pass: build.pass,
        current,
        build,
        qualifiedRun: qualification.runId,
        qualifiedAttempt: qualification.runAttempt,
        artifactId: qualification.artifactId,
        qualification: qualification.report,
      };
      await writeFile(path.join(output, "reuse.json"), JSON.stringify(receipt, null, 2) + "\n");
      console.error(
        `[ci] Reused complete test qualification from Actions run ${qualification.runId}; fresh build ${build.pass ? "passed" : "failed"}.`,
      );
      console.log(JSON.stringify(receipt));
      process.exitCode = receipt.pass ? 0 : 1;
      return;
    }
    await mkdir(output, { recursive: true });
    await writeFile(
      path.join(output, "reuse-decision.json"),
      JSON.stringify({ mode: "fresh", reason: "No matching trusted full qualification" }) + "\n",
    );
    console.error("[ci] No matching trusted qualification; running the complete verifier.");
  }
  const report = await runVerification({ root, onProgress: progress });
  console.log(JSON.stringify(report));
  process.exitCode = report.pass ? 0 : 1;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
