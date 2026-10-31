import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  githubReleaseState,
  installationRepository,
  healthSummary,
  releaseHealth,
  runPreviewHealth,
  safeHealthFailure,
} from "./preview-health.mjs";

process.env.GITHUB_REPOSITORY = "independent/kanbun";

const sha = "a".repeat(40);
const latest = {
  ci: {
    id: 1,
    status: "completed",
    conclusion: "success",
    sha,
    url: "https://github.com/independent/kanbun/actions/runs/1",
  },
  deploy: {
    id: 2,
    status: "completed",
    conclusion: "success",
    sha,
    url: "https://github.com/independent/kanbun/actions/runs/2",
  },
};
function receipt() {
  return { pass: false, checks: [] };
}
function hooks() {
  return {
    checks: {
      version: async () => "active",
      api: async () => ({ annotations: { "workers/tag": sha } }),
      smoke: async () => [{ path: "/", status: 302 }],
      d1Ping: async () => ({ pass: true }),
    },
    releases: async () => latest,
    sourceAllowed: async () => true,
  };
}

test("health requires Access, verified source, D1, successful release state and a stable version", async () => {
  const value = await runPreviewHealth(hooks(), receipt());
  assert.equal(value.pass, true);
  assert.equal(value.deploymentState, "current");
  assert.deepEqual(
    value.checks.map((check) => check.name),
    [
      "active-version",
      "deployed-source",
      "access-boundary",
      "accounts-connectivity",
      "github-releases",
      "deployment-state",
      "stable-active-version",
    ],
  );
  assert.match(healthSummary(value), /do not sign in/);
  assert.match(healthSummary(value), /Recovery runbook/);
});

test("a failed probe fails the report while preserving other independent results and excluding private errors", async () => {
  const input = hooks();
  input.checks.d1Ping = async () => {
    throw new Error("private-database-row-and-token");
  };
  const value = await runPreviewHealth(input, receipt());
  assert.equal(value.pass, false);
  assert.equal(value.checks.find((check) => check.name === "accounts-connectivity").pass, false);
  assert.equal(value.checks.at(-1).pass, true);
  assert(!JSON.stringify(value).includes("private-database"));
  assert(!healthSummary(value).includes("private-database"));
});

test("known source ancestry alone cannot conceal a failed or missing deployment", () => {
  assert.throws(
    () => releaseHealth(sha, { ...latest, deploy: { ...latest.deploy, conclusion: "failure" } }),
    /did not succeed/,
  );
  assert.throws(() => releaseHealth("b".repeat(40), latest), /differs from latest successful main CI/);
  assert.equal(
    releaseHealth("b".repeat(40), { ...latest, deploy: { ...latest.deploy, status: "in_progress", conclusion: null } }),
    "release-pending",
  );
});

test("unknown source and an active version changed during monitoring both fail", async () => {
  const input = hooks();
  input.sourceAllowed = async () => false;
  assert.equal((await runPreviewHealth(input, receipt())).pass, false);
  let reads = 0;
  const changed = hooks();
  changed.checks.version = async () => (++reads === 1 ? "before" : "after");
  const value = await runPreviewHealth(changed, receipt());
  assert.equal(value.pass, false);
  assert.equal(value.checks.at(-1).pass, false);
});

test("Actions reads are scoped, sanitized and require valid workflow metadata", async () => {
  const requests = [];
  const value = await githubReleaseState("private-token", async (url, options) => {
    requests.push({ url, options });
    return Response.json({
      workflow_runs: [
        {
          id: requests.length,
          status: "completed",
          conclusion: "success",
          head_sha: sha,
          html_url: "https://untrusted.example/private",
          actor: { email: "private@example.com" },
        },
      ],
    });
  });
  assert(requests[0].url.includes("&event=push&status=success"));
  assert.equal(value.deploy.url, "https://github.com/independent/kanbun/actions/runs/2");
  assert(!JSON.stringify(value).includes("private"));
  await assert.rejects(
    githubReleaseState("token", async () => Response.json({ message: "private" }, { status: 403 })),
    /request failed/,
  );
  assert(!JSON.stringify(safeHealthFailure(new Error("private"))).includes("private"));
});

test("a CI response without completed success cannot establish a healthy release", async () => {
  for (const [status, conclusion] of [
    ["in_progress", null],
    ["completed", "failure"],
  ]) {
    await assert.rejects(
      githubReleaseState("token", async () =>
        Response.json({
          workflow_runs: [{ id: 1, status, conclusion, head_sha: sha }],
        }),
      ),
      /completed successful main CI/,
    );
  }
});

test("malformed deployment credentials make the CLI fail and retain bounded receipt and summary", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./preview-health.mjs", import.meta.url))], {
    env: { ...process.env, CLOUDFLARE_API_TOKEN: "private credential marker!", GITHUB_TOKEN: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  const value = readFileSync(new URL("../artifacts/preview-health/receipt.json", import.meta.url), "utf8");
  assert.equal(JSON.parse(value).pass, false);
  assert.match(value, /cloudflare-credential/);
  assert(!value.includes("private credential"));
  assert(!result.stdout.includes("private credential"));
  assert.match(
    readFileSync(new URL("../artifacts/preview-health/summary.md", import.meta.url), "utf8"),
    /Recovery runbook/,
  );
});

test("health checks use the installation repository and reject malformed scope before any request", async () => {
  assert.equal(installationRepository("another-owner/project"), "another-owner/project");
  assert.throws(() => installationRepository("../other/repository"), /GITHUB_REPOSITORY/);
  let called = false;
  await assert.rejects(
    githubReleaseState(
      "token",
      async () => {
        called = true;
      },
      "bad/path/extra",
    ),
    /GITHUB_REPOSITORY/,
  );
  assert.equal(called, false);
});
