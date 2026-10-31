import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runVerification } from "../packages/verifier/src/index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function summarizeLeaks(findings) {
  if (!Array.isArray(findings)) throw new Error("Secret scanner did not produce a findings array.");
  return findings.map((finding) => ({
    rule: finding.RuleID,
    file: finding.File,
    line: finding.StartLine,
    commit: finding.Commit || null,
  }));
}

export function repositoryName(value) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(value ?? ""))
    throw new Error("Supply GITHUB_REPOSITORY=owner/repository for the repository assessment.");
  return value;
}

async function audit(kind) {
  if (!existsSync("/.dockerenv")) throw new Error("Run public audits through scripts/devcontainer.sh exec.");
  const pins = JSON.parse(await readFile(path.join(root, "config/audit-tools.json"), "utf8"));
  const directory = await mkdtemp(path.join(tmpdir(), "kanbun-public-audit-"));
  const source = await runVerification({ root, command: "doctor" });
  if (!source.pass) throw new Error("Environment diagnosis failed; inspect artifacts/verification.");
  const report = {
    schemaVersion: 1,
    kind,
    source: source.metadata.source,
    runtime: source.metadata.runtime,
    performedAt: new Date().toISOString(),
    pass: false,
    status: "blocked",
    tools: {},
    checks: [],
  };
  const run = (name, args) => {
    let binary = name;
    if (pins[name]) {
      const installed = `/home/node/.local/bin/${name}`;
      if (!existsSync(`/usr/local/bin/${name}`) && existsSync(installed)) binary = installed;
      const version = spawnSync(binary, pins[name].versionArgs, { encoding: "utf8" });
      if (version.status !== 0 || !version.stdout.includes(pins[name].version))
        throw new Error(`Rebuild the devcontainer to install pinned ${name} ${pins[name].version}.`);
      report.tools[name] = pins[name].version;
    }
    const result = spawnSync(binary, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (result.error || result.signal || result.status === null) throw new Error(`Could not execute ${name}.`);
    return result;
  };
  try {
    if (kind === "secrets") {
      if (
        execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: root, encoding: "utf8" }).trim() !==
        "false"
      )
        throw new Error("Fetch complete Git history before the publication scan.");
      const snapshot = path.join(directory, "tree");
      await mkdir(snapshot);
      const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
        cwd: root,
        encoding: "utf8",
      });
      for (const file of new Set(files.split("\0").filter(Boolean))) {
        if (!existsSync(path.join(root, file))) continue;
        const target = path.join(snapshot, file);
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(path.join(root, file), target);
      }
      for (const [name, args] of [
        ["history", ["git", "--log-opts=--all", root]],
        ["current-tree", ["dir", snapshot]],
      ]) {
        const output = path.join(directory, `${name}.json`);
        const result = run("gitleaks", [
          ...args,
          `--config=${path.join(root, ".gitleaks.toml")}`,
          "--redact=100",
          "--no-banner",
          "--report-format=json",
          `--report-path=${output}`,
        ]);
        if (![0, 1].includes(result.status)) throw new Error(`Secret scan ${name} could not complete.`);
        const findings = summarizeLeaks(JSON.parse(await readFile(output, "utf8")));
        report.checks.push({ name, pass: result.status === 0 && findings.length === 0, findings });
      }
      report.historyTip = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
      report.historyRefsSha256 = sha256(
        execFileSync("git", ["show-ref", "--head"], { cwd: root, encoding: "utf8" })
          .split("\n")
          .filter(Boolean)
          .sort()
          .join("\n"),
      );
    } else if (kind === "prose") {
      const files = ["README.md", "docs/evaluation.md", "docs/case-study.md"];
      const result = run("vale", ["--output=JSON", ...files]);
      if (![0, 1].includes(result.status)) throw new Error("Writing checks could not complete.");
      report.checks.push({ name: "writing-rules", pass: result.status === 0, findings: JSON.parse(result.stdout) });
    } else if (kind === "repository") {
      const repository = repositoryName(process.env.GITHUB_REPOSITORY);
      if (!process.env.GITHUB_TOKEN && !process.env.GITHUB_AUTH_TOKEN)
        throw new Error("Repository inspection requires a read token; no assessment was performed.");
      const result = run("scorecard", [
        "--repo",
        `github.com/${repository}`,
        "--checks=Branch-Protection,Token-Permissions,Pinned-Dependencies,Security-Policy",
        "--format=json",
      ]);
      if (result.status !== 0) throw new Error("Repository assessment could not complete with the supplied access.");
      const assessment = JSON.parse(result.stdout);
      // Preserve individual findings. A score is not a launch approval or proof of all repository settings.
      report.checks.push({ name: "scorecard", pass: true, assessment });
      report.repository = repository;
      report.requiresReview = true;
    } else {
      throw new Error("Choose secrets, prose, or repository.");
    }
    report.pass = report.checks.length > 0 && report.checks.every((check) => check.pass);
    report.status = report.pass ? "passed" : "failed";
  } catch (error) {
    report.error = error.message;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const output = path.join(root, "artifacts/launch", kind);
  await mkdir(output, { recursive: true });
  const bytes = JSON.stringify(report, null, 2) + "\n";
  const receipt = path.join(output, "report.json");
  await writeFile(receipt, bytes);
  console.log(
    JSON.stringify({
      kind,
      pass: report.pass,
      status: report.status,
      checks: report.checks.map(({ name, pass }) => ({ name, pass })),
      error: report.error,
      receipt,
      sha256: sha256(bytes),
    }),
  );
  process.exitCode = report.pass ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  audit(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
