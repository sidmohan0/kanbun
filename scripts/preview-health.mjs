import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareToken } from "./preview-credentials.mjs";
import { createPreviewChecks, PreviewCheckError } from "./preview-checks.mjs";

const repository = "sidmohan0/kanbun";
const actionsUrl = `https://github.com/${repository}/actions`;
const recoveryUrl = `https://github.com/${repository}/blob/main/docs/operations.md`;
const statuses = new Set(["queued", "in_progress", "completed", "waiting", "requested", "pending"]);
const conclusions = new Set([
  "success",
  "failure",
  "neutral",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "stale",
  "startup_failure",
]);

export function safeHealthFailure(error) {
  if (error instanceof PreviewCheckError) return { check: error.check, message: error.message, status: error.status };
  return {
    check: "unexpected",
    message: "Health check could not complete; inspect configuration and retry",
    status: null,
  };
}

export async function githubReleaseState(token, fetchImpl = fetch) {
  if (!token) throw new PreviewCheckError("github-releases", "GitHub repository Actions read access is required");
  async function runs(workflow, filters = "") {
    let response;
    try {
      response = await fetchImpl(
        `https://api.github.com/repos/${repository}/actions/workflows/${workflow}/runs?branch=main&per_page=1${filters}`,
        {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        },
      );
    } catch {
      throw new PreviewCheckError("github-releases", "GitHub Actions API unavailable");
    }
    if (!response.ok)
      throw new PreviewCheckError("github-releases", "GitHub Actions API request failed", response.status);
    let body;
    try {
      body = await response.json();
    } catch {
      throw new PreviewCheckError("github-releases", "Invalid GitHub Actions response");
    }
    const run = body?.workflow_runs?.[0];
    if (
      !run ||
      !Number.isSafeInteger(run.id) ||
      run.id <= 0 ||
      !statuses.has(run.status) ||
      (run.conclusion !== null && !conclusions.has(run.conclusion)) ||
      !/^[a-f0-9]{40}$/.test(run.head_sha ?? "")
    )
      throw new PreviewCheckError("github-releases", "No valid main workflow run is available");
    return {
      id: run.id,
      status: run.status,
      conclusion: run.conclusion,
      sha: run.head_sha,
      url: `${actionsUrl}/runs/${run.id}`,
    };
  }
  const [ci, deploy] = await Promise.all([runs("ci.yml", "&event=push&status=success"), runs("deploy-preview.yml")]);
  if (ci.status !== "completed" || ci.conclusion !== "success")
    throw new PreviewCheckError("github-releases", "No completed successful main CI run is available");
  return { ci, deploy };
}

/** Pending releases are visible, never described as deployment-current. Failed or missing releases fail. */
export function releaseHealth(deployedSha, state) {
  if (state.deploy.status === "completed" && state.deploy.conclusion !== "success")
    throw new PreviewCheckError(
      "latest-deployment",
      "Latest preview deployment did not succeed; inspect its workflow run",
    );
  if (deployedSha === state.ci.sha) return "current";
  if (state.deploy.status !== "completed") return "release-pending";
  throw new PreviewCheckError(
    "deployment-source",
    "Deployed source differs from latest successful main CI without an active release",
  );
}

export async function runPreviewHealth({ checks, releases, sourceAllowed }, receipt) {
  async function probe(name, action) {
    try {
      const result = await action();
      receipt.checks.push({ name, pass: true });
      return result;
    } catch (error) {
      receipt.checks.push({ name, pass: false, error: safeHealthFailure(error) });
      return null;
    }
  }
  const active = await probe("active-version", () => checks.version());
  receipt.version = active;
  let source = null;
  if (active) {
    source = await probe("deployed-source", async () => {
      const detail = await checks.api("/versions/" + active);
      const sha = detail?.annotations?.["workers/tag"];
      if (!/^[a-f0-9]{40}$/.test(sha ?? "") || !(await sourceAllowed(sha)))
        throw new PreviewCheckError("deployed-source", "Active Worker has no verified source commit on main");
      return sha;
    });
    receipt.deployedSha = source;
    receipt.security = await probe("access-boundary", () => checks.smoke(active));
  }
  receipt.database = await probe("accounts-connectivity", () => checks.d1Ping());
  const state = await probe("github-releases", releases);
  receipt.release = state;
  if (state && source) receipt.deploymentState = await probe("deployment-state", () => releaseHealth(source, state));
  if (active)
    await probe("stable-active-version", async () => {
      if ((await checks.version()) !== active)
        throw new PreviewCheckError(
          "active-version",
          "Active version changed during health checks; rerun after deployment",
        );
    });
  receipt.pass = receipt.checks.length > 0 && receipt.checks.every((check) => check.pass);
  return receipt;
}

export function healthSummary(receipt) {
  const lines = [
    "# Preview health",
    "",
    `Result: **${receipt.pass ? (receipt.deploymentState ?? "pass") : "failed"}**`,
    "",
    "Checks cover the anonymous authentication boundary, deployed source identity, release state, and a read-only D1 query.",
    "They do not sign in, execute authenticated application routes, or prove Durable Object/data health.",
    "",
  ];
  if (receipt.version) lines.push(`Worker version: \`${receipt.version}\``);
  if (receipt.deployedSha) lines.push(`Deployed source: \`${receipt.deployedSha}\``);
  if (receipt.release?.ci)
    lines.push(`Latest successful main CI: [${receipt.release.ci.sha}](${receipt.release.ci.url})`);
  if (receipt.release?.deploy)
    lines.push(
      `Latest deployment: [${receipt.release.deploy.status}${receipt.release.deploy.conclusion ? "/" + receipt.release.deploy.conclusion : ""}](${receipt.release.deploy.url})`,
    );
  lines.push("");
  for (const check of receipt.checks)
    lines.push(
      `- ${check.pass ? "PASS" : "FAIL"}: ${check.name}${check.error ? " — " + check.error.message + (check.error.status ? " (HTTP " + check.error.status + ")" : "") : ""}`,
    );
  if (receipt.error) lines.push("", receipt.error.message);
  lines.push(
    "",
    `[Recovery runbook](${recoveryUrl}) · [Deployments](${actionsUrl}/workflows/deploy-preview.yml)`,
    "",
    "A failed workflow can notify repository watchers through their GitHub notification settings. No extra email or external alert service is configured.",
    "",
  );
  return lines.join("\n");
}

async function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const directory = resolve(root, "artifacts/preview-health");
  mkdirSync(directory, { recursive: true });
  const receipt = {
    checkedAt: new Date().toISOString(),
    pass: false,
    version: null,
    deployedSha: null,
    deploymentState: null,
    checks: [],
    security: null,
    database: null,
    release: null,
  };
  try {
    const config = JSON.parse(readFileSync(resolve(root, "apps/worker/wrangler.preview.json"), "utf8"));
    let token;
    try {
      token = cloudflareToken(process.env.CLOUDFLARE_API_TOKEN);
    } catch {
      throw new PreviewCheckError(
        "cloudflare-credential",
        "Deployment credential is missing or malformed; update the existing Actions secret",
      );
    }
    await runPreviewHealth(
      {
        checks: createPreviewChecks(config, token),
        releases: () => githubReleaseState(process.env.GITHUB_TOKEN),
        sourceAllowed(sha) {
          try {
            execFileSync("git", ["merge-base", "--is-ancestor", sha, "refs/remotes/origin/main"], {
              cwd: root,
              stdio: "ignore",
            });
            return true;
          } catch {
            return false;
          }
        },
      },
      receipt,
    );
  } catch (error) {
    receipt.error = safeHealthFailure(error);
  }
  writeFileSync(resolve(directory, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  writeFileSync(resolve(directory, "summary.md"), healthSummary(receipt));
  console.log(
    `Preview health: ${receipt.pass ? (receipt.deploymentState ?? "pass") : "failed"}; evidence in artifacts/preview-health/`,
  );
  if (!receipt.pass) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
