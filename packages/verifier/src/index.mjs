import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { cp, mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { checkDocumentation } from "./docs.mjs";
import {
  collectLaunchEvidence,
  evaluateLaunchReadiness,
  readLaunchRegistry,
  validateLaunchRegistry,
} from "./launch.mjs";

const profiles = new Set([
  "all",
  "doctor",
  "check",
  "build",
  "smoke",
  "preflight",
  "recovery",
  "scale",
  "docs",
  "launch",
]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonFile = (file) => JSON.parse(readFileSync(file, "utf8"));

function runtimeMetadata() {
  try {
    readFileSync("/.dockerenv");
    return {
      platform: process.platform,
      architecture: process.arch,
      ci: process.env.CI === "true",
      osSha256: hash(readFileSync("/etc/os-release")),
      packagesSha256: hash(
        execFileSync("dpkg-query", ["-W", "-f=${binary:Package}=${Version}\\n"], { encoding: "utf8" }),
      ),
    };
  } catch {
    // Unsupported environments can verify normally, but cannot reuse qualification.
    return null;
  }
}

function workspaceManifests(root) {
  const manifests = [path.join(root, "package.json")];
  for (const directory of ["apps", "packages"]) {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = path.join(root, directory, entry.name, "package.json");
      try {
        if (lstatSync(manifest).isFile()) manifests.push(manifest);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  return manifests.sort();
}

function checkDependencies(root) {
  const missing = [];
  let count = 0;
  for (const manifest of workspaceManifests(root)) {
    const pkg = jsonFile(manifest);
    const require = createRequire(manifest);
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      count++;
      try {
        try {
          require.resolve(`${name}/package.json`);
        } catch {
          require.resolve(name);
        }
      } catch {
        missing.push(`${pkg.name}: ${name}`);
      }
    }
  }
  return {
    pass: missing.length === 0,
    details: missing.length
      ? `Missing installed dependencies:\n${missing.join("\n")}`
      : `${count} dependencies resolve.`,
  };
}

function sourceMetadata(root, outputDirectory) {
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  let head = null;
  try {
    head = git("rev-parse", "--verify", "HEAD").trim();
  } catch {
    // An initialized repository can have an unborn branch before its first commit.
  }
  let branch;
  try {
    branch = git("symbolic-ref", "--quiet", "--short", "HEAD").trim();
  } catch {
    branch = head ? "HEAD" : null;
  }
  const dirty = git("status", "--porcelain", "-z").length > 0;
  const files = {};
  const candidates = [...new Set(git("ls-files", "--cached", "--others", "--exclude-standard", "-z").split("\0"))];
  for (const name of candidates.filter(Boolean).sort()) {
    const absolute = path.resolve(root, name);
    if (absolute === outputDirectory || absolute.startsWith(outputDirectory + path.sep)) continue;
    try {
      if (lstatSync(absolute).isFile()) files[name] = hash(readFileSync(absolute));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      files[name] = null;
    }
  }
  if (!Object.keys(files).length) throw new Error("No source files were available to fingerprint.");
  return {
    head,
    tree: head ? git("rev-parse", "HEAD^{tree}").trim() : null,
    branch,
    dirty,
    lockfileSha256: hash(readFileSync(path.join(root, "pnpm-lock.yaml"))),
    sourceSha256: hash(JSON.stringify(files)),
    files,
  };
}

function plan(command, root, metadata, outputDirectory, evidenceFile) {
  const pin = readFileSync(path.join(root, ".nvmrc"), "utf8").trim().replace(/^v/, "");
  const packageManager = jsonFile(path.join(root, "package.json")).packageManager;
  if (!/^\d+\.\d+\.\d+$/.test(pin)) throw new Error(".nvmrc must pin an exact Node version.");
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(packageManager ?? "")) {
    throw new Error("package.json must pin an exact pnpm version.");
  }
  metadata.expected = { node: `v${pin}`, pnpm: packageManager.slice(5) };
  const steps = [
    {
      name: "doctor-node",
      command: ["node", "--version"],
      validate(stdout) {
        metadata.tools.pathNode = stdout.trim();
        const pass = stdout.trim() === `v${pin}` && process.version === `v${pin}`;
        return { pass, details: `Running ${process.version}; PATH node ${stdout.trim()}; expected v${pin}.` };
      },
    },
    {
      name: "doctor-pnpm",
      command: ["pnpm", "--version"],
      validate(stdout) {
        metadata.tools.pnpm = stdout.trim();
        return { pass: stdout.trim() === packageManager.slice(5), details: `Expected ${packageManager}.` };
      },
    },
    {
      name: "doctor-git",
      command: ["git", "--version"],
      validate(stdout) {
        metadata.tools.git = stdout.trim();
        return { pass: true, details: stdout.trim() };
      },
    },
    ...(["docs", "launch"].includes(command)
      ? []
      : [{ name: "doctor-dependencies", check: () => checkDependencies(root) }]),
    {
      name: "source-metadata",
      check() {
        metadata.source = sourceMetadata(root, outputDirectory);
        metadata.runtime = runtimeMetadata();
        return { pass: true, details: `Fingerprinted ${Object.keys(metadata.source.files).length} source files.` };
      },
    },
  ];
  if (command === "preflight")
    steps.push({ name: "preflight", command: ["pnpm", "--reporter=append-only", "test:recovery", "--preflight"] });
  if (command === "all" || command === "check") {
    for (const [name, args] of [
      ["check-format", ["format:check"]],
      ["check-lint", ["lint"]],
      ["check-types", ["typecheck"]],
      ["check-script-tests", ["test:scripts"]],
      ["check-spec-lock", ["spec:check", "--initial"]],
    ]) {
      steps.push({ name, command: ["pnpm", "--reporter=append-only", ...args] });
    }
    steps.push({
      name: "launch-registry",
      check() {
        const errors = validateLaunchRegistry(readLaunchRegistry(root));
        return {
          pass: errors.length === 0,
          details: errors.length ? errors.join("\n") : "Launch requirements and verification contracts are valid.",
        };
      },
    });
    if (command === "all")
      steps.push({ name: "preflight", command: ["pnpm", "--reporter=append-only", "test:recovery", "--preflight"] });
    steps.push({
      name: "check-tests",
      command: ["pnpm", "--reporter=append-only", "test"],
      ...(process.env.CI === "true" ? {} : { env: { KANBUN_TEST_WORKSPACE_CONCURRENCY: "1" } }),
    });
  }
  if (command === "launch") {
    steps.push({
      name: "launch",
      async check() {
        const evidence = evidenceFile
          ? jsonFile(path.resolve(root, evidenceFile))
          : collectLaunchEvidence({ root, source: metadata.source });
        const launch = await evaluateLaunchReadiness({ root, source: metadata.source, evidence });
        return { pass: launch.pass, details: JSON.stringify(launch, null, 2), launch };
      },
    });
  }
  if (command === "all" || command === "build")
    steps.push({
      name: "build",
      command: ["pnpm", "--reporter=append-only", command === "all" ? "build:verified" : "build"],
    });
  if (command === "all" || command === "smoke")
    steps.push({ name: "smoke", command: ["pnpm", "--reporter=append-only", "seed"] });
  if (command === "all" || command === "recovery")
    steps.push({
      name: "recovery",
      command: ["pnpm", "--reporter=append-only", "test:recovery", ...(command === "all" ? ["--remaining"] : [])],
      ...(command === "all" ? { env: { KANBUN_SKIP_SCALE: "1" } } : {}),
    });
  if (
    command === "scale" ||
    (command === "all" && !(process.env.CI === "true" && process.env.GITHUB_EVENT_NAME === "pull_request"))
  )
    steps.push({ name: "scale", command: ["pnpm", "--reporter=append-only", "test:recovery", "app-scale.spec.ts"] });
  if (command === "all" || command === "docs") {
    steps.push({
      name: "docs",
      async check() {
        const checks = await checkDocumentation(root);
        if (
          !Array.isArray(checks) ||
          !checks.length ||
          checks.some(
            (check) =>
              typeof check.name !== "string" || typeof check.pass !== "boolean" || typeof check.details !== "string",
          )
        ) {
          throw new Error("Documentation checks returned an empty or malformed result.");
        }
        return { pass: checks.every((check) => check.pass), details: JSON.stringify(checks, null, 2), checks };
      },
    });
  }
  return steps;
}

async function execute(step, root, runDirectory, index) {
  const prefix = path.join(runDirectory, `${String(index + 1).padStart(2, "0")}-${step.name}`);
  const result = {
    name: step.name,
    command: step.command ?? null,
    executed: false,
    pass: false,
    exitCode: null,
    signal: null,
    durationMs: 0,
    stdoutLog: `${prefix}.stdout.log`,
    stderrLog: `${prefix}.stderr.log`,
  };
  const started = performance.now();
  let stdout, stderr;
  try {
    stdout = await open(result.stdoutLog, "wx");
    stderr = await open(result.stderrLog, "wx");
    if (step.command) {
      let spawnError;
      const child = spawn(step.command[0], step.command.slice(1), {
        cwd: root,
        stdio: ["ignore", stdout.fd, stderr.fd],
        env: {
          ...process.env,
          ...step.env,
          npm_config_manage_package_manager_versions: "false",
          COREPACK_ENABLE_NETWORK: "0",
          COREPACK_ENABLE_AUTO_PIN: "0",
        },
      });
      child.once("spawn", () => {
        result.executed = true;
      });
      child.once("error", (error) => {
        spawnError = error;
      });
      await new Promise((resolve) =>
        child.once("close", (code, signal) => {
          result.exitCode = code;
          result.signal = signal;
          resolve();
        }),
      );
      if (spawnError) {
        result.exitCode = null;
        result.signal = null;
        throw spawnError;
      }
      result.pass = result.exitCode === 0 && result.signal === null;
      if (result.pass && step.validate) Object.assign(result, step.validate(await readFile(result.stdoutLog, "utf8")));
    } else {
      result.executed = true;
      Object.assign(result, await step.check());
      await stdout.writeFile(result.details + "\n");
    }
  } catch (error) {
    result.pass = false;
    result.error = error.message;
    if (stderr) await stderr.writeFile(error.message + "\n").catch(() => {});
  } finally {
    try {
      await stdout?.close();
      await stderr?.close();
      await readFile(result.stdoutLog);
      await readFile(result.stderrLog);
    } catch (error) {
      result.pass = false;
      result.error = `Verification logs unavailable: ${error.message}`;
    }
    result.durationMs = performance.now() - started;
  }
  return result;
}

export async function runVerification({
  root,
  command = "all",
  outputDirectory,
  evidenceFile,
  onProgress = () => {},
} = {}) {
  const started = performance.now();
  let localDirectory;
  const report = {
    schemaVersion: 1,
    command,
    pass: false,
    executed: false,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    runDirectory: null,
    reportWritten: false,
    metadata: { tools: { node: process.version, nodeExecutable: process.execPath }, source: null },
    steps: [],
  };
  try {
    if (!profiles.has(command)) throw new Error(`Unknown verification profile: ${command}`);
    if (evidenceFile && command !== "launch") throw new Error("--evidence is supported only by the launch profile.");
    root = path.resolve(root);
    outputDirectory = path.resolve(outputDirectory ?? path.join(root, "artifacts", "verification"));
    const steps = plan(command, root, report.metadata, outputDirectory, evidenceFile);
    report.metadata.scaleExcluded = process.env.CI === "true" && process.env.GITHUB_EVENT_NAME === "pull_request";
    await mkdir(outputDirectory, { recursive: true });
    report.runDirectory = await mkdtemp(path.join(outputDirectory, "run-"));
    localDirectory = await mkdtemp(path.join(tmpdir(), "kanbun-verification-"));
    const cheap = new Set([
      "check-format",
      "check-lint",
      "check-types",
      "check-script-tests",
      "check-spec-lock",
      "launch-registry",
    ]);
    const buildAndSmoke = new Set(["build", "smoke"]);
    const perform = async (index) => {
      const step = steps[index];
      onProgress({ name: step.name, state: "start" });
      const result = await execute(step, root, localDirectory, index);
      onProgress({ name: step.name, state: result.pass ? "pass" : "fail", durationMs: result.durationMs });
      return result;
    };
    const skipped = (step) => ({
      name: step.name,
      command: step.command ?? null,
      executed: false,
      pass: false,
      exitCode: null,
      durationMs: 0,
      reason: "A prerequisite or earlier step failed.",
    });
    let failed = false;
    for (let index = 0; index < steps.length;) {
      const group = cheap.has(steps[index].name)
        ? cheap
        : command === "all" && buildAndSmoke.has(steps[index].name)
          ? buildAndSmoke
          : null;
      let end = index + 1;
      while (group && end < steps.length && group.has(steps[end].name)) end++;
      if (failed) report.steps.push(...steps.slice(index, end).map(skipped));
      else {
        // Execute each group with bounded concurrency, but retain the planned receipt order.
        const results = new Array(end - index);
        let next = index;
        await Promise.all(
          Array.from({ length: Math.min(4, end - index) }, async () => {
            while (next < end) {
              const current = next++;
              results[current - index] = await perform(current);
            }
          }),
        );
        report.steps.push(...results);
        failed = results.some((result) => !result.pass);
      }
      index = end;
    }
    report.executed = report.steps.some((step) => step.executed);
    report.pass = report.steps.length > 0 && report.steps.every((step) => step.executed && step.pass);
    for (const step of report.steps.filter((step) => step.executed)) {
      await readFile(step.stdoutLog);
      await readFile(step.stderrLog);
    }
  } catch (error) {
    report.pass = false;
    report.error = error.message;
  }
  report.durationMs = performance.now() - started;
  if (localDirectory) {
    const exportDirectory = report.runDirectory;
    const relocateLogs = (from, to) => {
      for (const step of report.steps) {
        for (const field of ["stdoutLog", "stderrLog"])
          if (step[field]?.startsWith(from + path.sep)) step[field] = to + step[field].slice(from.length);
      }
    };
    relocateLogs(localDirectory, exportDirectory);
    const localReceipt = path.join(localDirectory, "report.json");
    let receiptWritten = false;
    try {
      report.reportWritten = true;
      await writeFile(localReceipt, JSON.stringify(report, null, 2) + "\n", {
        flag: "wx",
      });
      receiptWritten = true;
    } catch (error) {
      report.pass = false;
      report.reportWritten = false;
      report.error = `Verification report could not be written: ${error.message}`;
    }
    try {
      // Copy a completed receipt last so a partial export cannot advertise successful verification.
      await cp(localDirectory, exportDirectory, { recursive: true, filter: (source) => source !== localReceipt });
      if (receiptWritten)
        await cp(localReceipt, path.join(exportDirectory, "report.json"), { force: false, errorOnExist: true });
      await rm(localDirectory, { recursive: true, force: true });
    } catch (error) {
      report.pass = false;
      report.reportWritten = false;
      report.error = `Verification artifacts could not be exported to ${exportDirectory}: ${error.message}`;
      report.runDirectory = localDirectory;
      report.recoveryDirectory = localDirectory;
      relocateLogs(exportDirectory, localDirectory);
      try {
        report.reportWritten = true;
        await writeFile(localReceipt, JSON.stringify(report, null, 2) + "\n");
      } catch (writeError) {
        report.reportWritten = false;
        report.error += `; recovery receipt could not be written: ${writeError.message}`;
      }
    }
  }
  return report;
}
