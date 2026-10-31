import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { checkDocumentation } from "./docs.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const sha256 = /^[a-f0-9]{64}$/;
const methods = new Set(["files", "documentation", "review", "rehearsal", "verifier", "audit"]);
const groups = [
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
const requiredCriteria = {
  "PUB-01": 2,
  "PUB-02": 2,
  "PUB-03": 1,
  "RUN-01": 3,
  "RUN-02": 2,
  "OPS-01": 2,
  "DOC-01": 3,
  "GOV-01": 2,
  "BIZ-01": 1,
  "PORT-01": 2,
  "REL-01": 2,
};
const fullSuite = [
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

function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function relativeFile(file) {
  return text(file) && !path.isAbsolute(file) && !file.split(/[\\/]/).includes("..") && !file.includes("\\");
}

function safeFile(root, file) {
  if (!relativeFile(file)) throw new Error(`Expected a repository-relative path: ${file}`);
  const absolute = path.resolve(root, file);
  const resolved = realpathSync(absolute);
  if (!resolved.startsWith(realpathSync(root) + path.sep) || !statSync(resolved).isFile())
    throw new Error(`Evidence path must be a regular file inside the repository: ${file}`);
  return absolute;
}

export function readLaunchRegistry(root) {
  return JSON.parse(readFileSync(path.join(root, "docs/launch/criteria.json"), "utf8"));
}

export function validateLaunchRegistry(registry) {
  const errors = [];
  if (registry?.schemaVersion !== 1 || !Array.isArray(registry.requirements))
    return ["Launch registry requires schemaVersion 1 and a requirements array."];
  const seen = new Set();
  const foundGroups = [];
  for (const requirement of registry.requirements) {
    if (!requirement || typeof requirement !== "object") {
      errors.push("Each launch requirement must be an object.");
      continue;
    }
    foundGroups.push(requirement.id);
    if (!groups.includes(requirement.id) || !text(requirement.title) || ![0, 1, 2, 3].includes(requirement.priority))
      errors.push(`Invalid launch requirement: ${requirement.id}`);
    if (!Array.isArray(requirement.criteria) || !requirement.criteria.length) {
      errors.push(`${requirement.id}: acceptance criteria are required.`);
      continue;
    }
    for (const criterion of requirement.criteria) {
      if (!criterion || typeof criterion !== "object") {
        errors.push(`${requirement.id}: acceptance criteria must be objects.`);
        continue;
      }
      if (
        !/^(?:PUB|RUN|OPS|DOC|GOV|BIZ|PORT|REL)-\d{2}\.\d{2}$/.test(criterion.id) ||
        !criterion.id.startsWith(`${requirement.id}.`) ||
        seen.has(criterion.id)
      )
        errors.push(`Invalid or duplicate criterion ID: ${criterion.id}`);
      seen.add(criterion.id);
      if (!text(criterion.assertion) || !text(criterion.procedure) || !text(criterion.owner))
        errors.push(`${criterion.id}: assertion, procedure, and responsible owner are required.`);
      if (!methods.has(criterion.method)) errors.push(`${criterion.id}: unknown verification method.`);
      if (criterion.method === "audit" && !["secrets", "prose"].includes(criterion.auditKind))
        errors.push(`${criterion.id}: audit checks need a supported audit kind.`);
      if (
        !Array.isArray(criterion.scope) ||
        !criterion.scope.length ||
        criterion.scope.some((file) => !relativeFile(file))
      )
        errors.push(`${criterion.id}: a nonempty repository-relative source scope is required.`);
      if (
        criterion.method === "files" &&
        (!Array.isArray(criterion.files) ||
          !criterion.files.length ||
          criterion.files.some((file) => !relativeFile(file)))
      )
        errors.push(`${criterion.id}: files checks need explicit repository-relative files.`);
      if (
        criterion.tests !== undefined &&
        (!Array.isArray(criterion.tests) || criterion.tests.some((file) => !relativeFile(file)))
      )
        errors.push(`${criterion.id}: test references must be repository-relative paths.`);
    }
  }
  if (
    foundGroups.length !== groups.length ||
    new Set(foundGroups).size !== groups.length ||
    groups.some((id) => !foundGroups.includes(id))
  )
    errors.push("Registry must retain each agreed launch requirement exactly once.");
  for (const [group, count] of Object.entries(requiredCriteria))
    for (let index = 1; index <= count; index++) {
      const id = `${group}.${String(index).padStart(2, "0")}`;
      if (!seen.has(id)) errors.push(`Required launch acceptance criterion is missing: ${id}`);
    }
  return errors;
}

export function fingerprintCriterion(criterion, source) {
  const files = {};
  const missing = [];
  for (const scope of criterion.scope) {
    const matches = Object.keys(source.files)
      .filter((file) => scope === "." || (scope.endsWith("/") ? file.startsWith(scope) : file === scope))
      .sort();
    if (!matches.length) missing.push(scope);
    for (const file of matches) {
      files[file] = source.files[file];
      if (!sha256.test(source.files[file] ?? "")) missing.push(file);
    }
  }
  return {
    criterionSha256: digest(JSON.stringify(criterion)),
    scopeSha256: digest(
      JSON.stringify(Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))),
    ),
    files,
    missing,
  };
}

function validateArtifacts(root, artifacts) {
  if (!Array.isArray(artifacts) || !artifacts.length) throw new Error("Evidence needs retained artifacts.");
  const seen = new Set();
  for (const artifact of artifacts) {
    if (!sha256.test(artifact.sha256 ?? "") || seen.has(artifact.path))
      throw new Error("Invalid or duplicate artifact digest.");
    seen.add(artifact.path);
    if (digest(readFileSync(safeFile(root, artifact.path))) !== artifact.sha256)
      throw new Error(`Artifact content changed: ${artifact.path}`);
  }
}

function validateVerifierReceipt(root, entry, source) {
  const artifact = entry.artifacts.find((item) => item.path === entry.receipt);
  if (!artifact) throw new Error("Verifier evidence must identify its receipt as a hashed artifact.");
  const receipt = JSON.parse(readFileSync(safeFile(root, entry.receipt), "utf8"));
  if (
    receipt.schemaVersion !== 1 ||
    receipt.command !== "all" ||
    receipt.pass !== true ||
    receipt.executed !== true ||
    receipt.reportWritten !== true
  )
    throw new Error("Evidence must be a completed passing full-verifier receipt.");
  if (!sha256.test(source.sourceSha256 ?? "") || receipt.metadata?.source?.sourceSha256 !== source.sourceSha256)
    throw new Error("Full-verifier evidence does not match the current source fingerprint.");
  const node = `v${readFileSync(path.join(root, ".nvmrc"), "utf8").trim()}`;
  const packageManager = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).packageManager;
  const runtime = receipt.metadata?.runtime;
  if (
    runtime?.platform !== "linux" ||
    !["arm64", "x64"].includes(runtime.architecture) ||
    !sha256.test(runtime.osSha256 ?? "") ||
    !sha256.test(runtime.packagesSha256 ?? "")
  )
    throw new Error("Full-verifier evidence must identify the Linux devcontainer runtime and package inventory.");
  if (
    receipt.metadata?.tools?.node !== node ||
    receipt.metadata?.tools?.pathNode !== node ||
    `pnpm@${receipt.metadata?.tools?.pnpm}` !== packageManager
  )
    throw new Error("Full-verifier tool identities do not match the pinned Node and pnpm versions.");
  if (
    !Array.isArray(receipt.steps) ||
    receipt.steps.length !== fullSuite.length ||
    new Set(receipt.steps.map((step) => step.name)).size !== fullSuite.length
  )
    throw new Error("Full-verifier receipt has an incomplete or duplicate suite.");
  for (const name of fullSuite) {
    const step = receipt.steps.find((item) => item.name === name);
    if (!step?.executed || step.pass !== true) throw new Error(`Required verifier step did not pass: ${name}`);
    for (const field of ["stdoutLog", "stderrLog"]) {
      if (!text(receipt.runDirectory) || !text(step[field]) || path.dirname(step[field]) !== receipt.runDirectory)
        throw new Error(`Verifier log is outside its recorded run directory: ${name}/${field}`);
      const relative = path.join(path.dirname(entry.receipt), path.basename(step[field]));
      if (!entry.artifacts.some((item) => item.path === relative))
        throw new Error(`Unbound verifier log: ${name}/${field}`);
      safeFile(root, relative);
    }
  }
}

function validateAuditReceipt(root, criterion, entry, source) {
  if (!entry.artifacts.some((artifact) => artifact.path === entry.receipt))
    throw new Error("Audit evidence must identify its receipt as a hashed artifact.");
  const receipt = JSON.parse(readFileSync(safeFile(root, entry.receipt), "utf8"));
  if (
    receipt.schemaVersion !== 1 ||
    receipt.kind !== criterion.auditKind ||
    receipt.status !== entry.status ||
    receipt.source?.sourceSha256 !== source.sourceSha256
  )
    throw new Error("Audit kind, result or source fingerprint is incompatible with this candidate.");
  if (entry.status !== "passed") {
    if (receipt.pass === true) throw new Error("Audit result contradicts its supplied outcome.");
    return;
  }
  const expected = criterion.auditKind === "secrets" ? ["history", "current-tree"] : ["writing-rules"];
  const tool = criterion.auditKind === "secrets" ? "gitleaks" : "vale";
  const pins = JSON.parse(readFileSync(path.join(root, "config/audit-tools.json"), "utf8"));
  if (receipt.pass !== true || receipt.tools?.[tool] !== pins[tool]?.version || !text(receipt.tools?.[tool]))
    throw new Error("Audit did not pass with the pinned tool version.");
  if (
    !Array.isArray(receipt.checks) ||
    receipt.checks.length !== expected.length ||
    expected.some((name) => receipt.checks.filter((check) => check.name === name && check.pass === true).length !== 1)
  )
    throw new Error("Audit is missing required executed checks.");
  if (criterion.auditKind === "secrets" && receipt.historyTip !== source.head)
    throw new Error("Secret-history scan does not cover the current HEAD.");
  if (criterion.auditKind === "secrets") {
    const refs = execFileSync("git", ["show-ref", "--head"], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .sort()
      .join("\n");
    if (!sha256.test(receipt.historyRefsSha256 ?? "") || receipt.historyRefsSha256 !== digest(refs))
      throw new Error("Secret-history scan does not cover the current reachable ref inventory.");
  }
}

function validateLocalReceipt(root, entry, source) {
  if (source.dirty !== false || !text(source.head))
    throw new Error("Clean committed source is required for the local clone rehearsal.");
  const recorded = readFileSync(safeFile(root, "artifacts/launch/local/source-commit.txt"), "utf8").trim();
  if (recorded !== source.head)
    throw new Error("Local installation rehearsal does not match the current committed source.");
  const expected = JSON.parse(readFileSync(safeFile(root, "artifacts/launch/local/expected.json"), "utf8"));
  if (!/^kanbun-install\.[A-Za-z0-9]+$/.test(expected.runId ?? "") || expected.sourceCommit !== source.head)
    throw new Error("Local expected data must identify this rehearsal run and source commit.");
  let rehearsalRoot;
  for (const operation of ["create", "restart", "rebuild", "reset-verified"]) {
    const file = `artifacts/launch/local/${operation}.json`;
    if (!entry.artifacts.some((artifact) => artifact.path === file))
      throw new Error(`Missing bound local operation: ${operation}`);
    const receipt = JSON.parse(readFileSync(safeFile(root, file), "utf8"));
    if (
      receipt.pass !== true ||
      receipt.operation !== operation ||
      !text(receipt.root) ||
      !Number.isFinite(Date.parse(receipt.performedAt))
    )
      throw new Error(`Local operation did not pass: ${operation}`);
    rehearsalRoot ??= receipt.root;
    if (
      receipt.runId !== expected.runId ||
      receipt.sourceCommit !== expected.sourceCommit ||
      receipt.root !== rehearsalRoot
    )
      throw new Error(`Local evidence mixes different rehearsal runs or source commits: ${operation}`);
  }
  for (const file of [
    "artifacts/launch/local/source-commit.txt",
    "artifacts/launch/local/expected.json",
    "artifacts/launch/local/lifecycle.log",
  ])
    if (!entry.artifacts.some((artifact) => artifact.path === file))
      throw new Error(`Missing bound local evidence: ${file}`);
}

function evaluateEvidence(root, criterion, fingerprint, entries, source) {
  const matches = entries.filter((entry) => entry.criterion === criterion.id);
  if (!matches.length)
    return {
      status:
        criterion.method === "review" ? "pending-review" : criterion.method === "rehearsal" ? "blocked" : "not-run",
      details: `Required ${criterion.method} evidence has not been supplied.`,
    };
  if (matches.length !== 1)
    return { status: "failed", details: "Ambiguous evidence: provide exactly one current record per criterion." };
  const entry = matches[0];
  try {
    if (entry.kind !== criterion.method || !["passed", "failed", "blocked"].includes(entry.status))
      throw new Error("Evidence kind/status is incompatible with the criterion.");
    if (entry.criterionSha256 !== fingerprint.criterionSha256 || entry.scopeSha256 !== fingerprint.scopeSha256)
      throw new Error("Evidence is stale: the criterion or scoped source changed.");
    if (
      !["performedBy", "environment", "procedure", "conclusion"].every((field) => text(entry[field])) ||
      !text(entry.performedAt) ||
      !Number.isFinite(Date.parse(entry.performedAt))
    )
      throw new Error("Evidence must identify its producer, date, environment, procedure, and conclusion.");
    validateArtifacts(root, entry.artifacts);
    if (criterion.method === "verifier") validateVerifierReceipt(root, entry, source);
    if (criterion.method === "audit") validateAuditReceipt(root, criterion, entry, source);
    if (entry.producer === "local-install-probe") validateLocalReceipt(root, entry, source);
    return { status: entry.status, details: entry.conclusion, evidence: entry };
  } catch (error) {
    return { status: "failed", details: error.message };
  }
}

/** Collect maintained producers' retained artifacts without executing external operations. */
export function collectLaunchEvidence({ root, source, registry = readLaunchRegistry(root), verifierReceipt }) {
  const entries = [];
  const criteria = registry.requirements.flatMap((requirement) => requirement.criteria);
  const bind = (criterion, files, fields) => ({
    criterion: criterion.id,
    kind: criterion.method,
    status: "passed",
    ...fingerprintCriterion(criterion, source),
    performedBy: "Maintained evidence producer",
    performedAt: new Date().toISOString(),
    environment: "Recorded in the retained producer receipt",
    procedure: criterion.procedure,
    conclusion: "Retained producer evidence was collected; validation is performed by the launch evaluator.",
    artifacts: files.map((file) => ({ path: file, sha256: digest(readFileSync(safeFile(root, file))) })),
    ...fields,
  });
  for (const criterion of criteria.filter((item) => item.method === "audit")) {
    const receipt = `artifacts/launch/${criterion.auditKind}/report.json`;
    if (!existsSync(path.join(root, receipt))) continue;
    const report = JSON.parse(readFileSync(safeFile(root, receipt), "utf8"));
    entries.push(
      bind(criterion, [receipt], {
        receipt,
        status: report.status,
        performedAt: report.performedAt,
        conclusion: report.error ?? `Collected ${criterion.auditKind} audit result.`,
      }),
    );
  }
  const local = criteria.find((criterion) => criterion.id === "RUN-01.02");
  const localFiles = [
    "source-commit.txt",
    "expected.json",
    "lifecycle.log",
    "create.json",
    "restart.json",
    "rebuild.json",
    "reset-verified.json",
  ].map((file) => `artifacts/launch/local/${file}`);
  if (local && localFiles.every((file) => existsSync(path.join(root, file)))) {
    const report = JSON.parse(readFileSync(safeFile(root, "artifacts/launch/local/reset-verified.json"), "utf8"));
    entries.push(
      bind(local, localFiles, {
        producer: "local-install-probe",
        performedAt: report.performedAt,
        conclusion:
          "Collected clean-clone initialization, issue operations, restart, replacement, and deliberate-reset receipts.",
      }),
    );
  }
  if (!verifierReceipt && existsSync(path.join(root, "artifacts/verification"))) {
    const candidates = [];
    for (const directory of readdirSync(path.join(root, "artifacts/verification"), { withFileTypes: true })) {
      if (!directory.isDirectory()) continue;
      const file = `artifacts/verification/${directory.name}/report.json`;
      if (!existsSync(path.join(root, file))) continue;
      try {
        const report = JSON.parse(readFileSync(safeFile(root, file), "utf8"));
        if (report.command === "all" && report.metadata?.source?.sourceSha256 === source.sourceSha256)
          candidates.push({ file, report });
      } catch {
        /* Malformed historical receipts are never reusable evidence. */
      }
    }
    candidates.sort((a, b) => String(b.report.startedAt).localeCompare(String(a.report.startedAt)));
    verifierReceipt = candidates[0]?.file;
  }
  const verifier = criteria.find((criterion) => criterion.id === "REL-01.01");
  if (verifierReceipt && verifier) {
    const report = JSON.parse(readFileSync(safeFile(root, verifierReceipt), "utf8"));
    const files = [
      verifierReceipt,
      ...(report.steps ?? []).flatMap((step) =>
        ["stdoutLog", "stderrLog"]
          .filter((field) => text(step[field]))
          .map((field) => path.join(path.dirname(verifierReceipt), path.basename(step[field]))),
      ),
    ];
    entries.push(
      bind(verifier, files, {
        receipt: verifierReceipt,
        performedAt: report.startedAt,
        conclusion: "Collected full-verifier receipt and retained command logs.",
      }),
    );
  }
  return { schemaVersion: 1, entries };
}

export async function evaluateLaunchReadiness({
  root,
  source,
  registry = readLaunchRegistry(root),
  evidence = { schemaVersion: 1, entries: [] },
}) {
  const errors = validateLaunchRegistry(registry);
  if (evidence?.schemaVersion !== 1 || !Array.isArray(evidence.entries))
    errors.push("Evidence requires schemaVersion 1 and entries array.");
  else if (evidence.entries.some((entry) => !entry || typeof entry !== "object"))
    errors.push("Every evidence entry must be an object.");
  if (!source?.files || !sha256.test(source.sourceSha256 ?? "")) errors.push("Current source fingerprint is required.");
  if (errors.length) return { schemaVersion: 1, pass: false, status: "failed", errors, requirements: [] };
  const ids = new Set(
    registry.requirements.flatMap((requirement) => requirement.criteria.map((criterion) => criterion.id)),
  );
  for (const entry of evidence.entries)
    if (!ids.has(entry.criterion)) errors.push(`Evidence refers to unknown criterion: ${entry.criterion}`);
  const requirements = [];
  let docs;
  for (const requirement of registry.requirements) {
    const criteria = [];
    for (const criterion of requirement.criteria) {
      const fingerprint = fingerprintCriterion(criterion, source);
      let result;
      const missing = [
        ...fingerprint.missing,
        ...(criterion.tests ?? []).filter((file) => !existsSync(path.join(root, file))),
      ];
      if (missing.length)
        result = { status: "failed", details: `Missing scoped source/test references: ${missing.join(", ")}` };
      else if (criterion.method === "files") {
        const absent = criterion.files.filter((file) => {
          try {
            return readFileSync(safeFile(root, file)).length === 0;
          } catch {
            return true;
          }
        });
        result = {
          status: absent.length ? "failed" : "passed",
          details: absent.length
            ? `Missing or empty required files: ${absent.join(", ")}`
            : "Required files exist and are nonempty; semantic review is evaluated separately.",
        };
      } else if (criterion.method === "documentation") {
        docs ??= await checkDocumentation(root);
        const pass = Array.isArray(docs) && docs.length > 0 && docs.every((check) => check.pass === true);
        result = {
          status: pass ? "passed" : "failed",
          details: "Mechanical documentation checks: " + JSON.stringify(docs),
        };
      } else result = evaluateEvidence(root, criterion, fingerprint, evidence.entries, source);
      criteria.push({ ...criterion, ...fingerprint, ...result });
    }
    requirements.push({
      id: requirement.id,
      title: requirement.title,
      priority: requirement.priority,
      pass: criteria.every((criterion) => criterion.status === "passed"),
      criteria,
    });
  }
  return {
    schemaVersion: 1,
    pass: !errors.length && requirements.every((requirement) => requirement.pass),
    sourceSha256: source.sourceSha256,
    errors,
    requirements,
    trust:
      "External rehearsal and review records are producer attestations. Artifact hashes detect changes; they do not authenticate the producer or prove a human conclusion.",
  };
}
