import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { release, assertCompatibleSchema, SupersededRelease } from "./preview-release-control.mjs";
import { cloudflareToken } from "./preview-credentials.mjs";
import { createPreviewChecks } from "./preview-checks.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
const config = JSON.parse(readFileSync(new URL("../apps/worker/wrangler.preview.json", import.meta.url)));
const sha = process.argv[2];
const token = cloudflareToken(process.env.CLOUDFLARE_API_TOKEN);
// Wrangler subprocesses must receive the same normalized value as direct API calls.
process.env.CLOUDFLARE_API_TOKEN = token;
const run = (...args) => execFileSync("pnpm", args, { cwd: root, stdio: "inherit" });
const { request, api, version, smoke } = createPreviewChecks(config, token);
async function deploy(expectedPrevious) {
  run("deploy:preview", "--sha", sha, "--check");
  const previous = await version();
  if (previous !== expectedPrevious)
    throw new Error("Active version changed before preflight; no deployment performed");
  const detail = await api("/versions/" + previous);
  // Bootstrap from the exact manually verified domain-cutover deployment. Later versions carry their SHA.
  const previousSha =
    detail.annotations?.["workers/tag"] ||
    (previous === "5b1dac1a-00d8-47fd-9129-cc8c50d8a535" ? "102eb256cd75f80932a18f6b9043722ef9f86d34" : null);
  if (!/^[a-f0-9]{40}$/.test(previousSha ?? ""))
    throw new Error("Previous version has no known source SHA; review schema compatibility manually");
  const schemaChanges = execFileSync(
    "git",
    ["diff", "--name-only", previousSha, sha, "--", "packages/model/migrations"],
    { cwd: root, encoding: "utf8" },
  ).trim();
  const previousConfig = JSON.parse(
    execFileSync("git", ["show", `${previousSha}:apps/worker/wrangler.preview.json`], { cwd: root, encoding: "utf8" }),
  );
  assertCompatibleSchema(schemaChanges, previousConfig, config);
  await smoke(previous);
  const database = config.d1_databases.find((database) => database.binding === "ACCOUNTS");
  const rows = await request(
    `https://api.cloudflare.com/client/v4/accounts/${config.account_id}/d1/database/${database.database_id}/query`,
    { method: "POST", body: JSON.stringify({ sql: "SELECT name FROM d1_migrations ORDER BY name" }) },
  );
  const applied = rows[0]?.results?.map((row) => row.name).sort();
  const local = readdirSync(new URL("../packages/model/migrations/accounts/", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (JSON.stringify(applied) !== JSON.stringify(local))
    throw new Error("Remote accounts migrations differ: apply a separately reviewed compatible schema rollout first");
  run("build");
  // Recheck after the build so an older workflow cannot publish over newer main.
  if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN with repository read access is required");
  const head = await fetch("https://api.github.com/repos/sidmohan0/kanbun/git/ref/heads/main", {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!head.ok) throw new Error("Cannot verify current main before publishing");
  const current = (await head.json()).object?.sha;
  if (current !== sha) throw new SupersededRelease();
  if ((await version()) !== previous)
    throw new Error("Active version changed during preflight; no deployment performed");
  const output = execFileSync(
    "pnpm",
    ["--filter", "@kanbun/worker", "exec", "wrangler", "deploy", "--config", "wrangler.preview.json", "--tag", sha],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  process.stdout.write(output);
  const candidate = output.match(/Current Version ID:\s*([a-f0-9-]{36})/i)?.[1];
  if (!candidate) throw new Error("Deployment did not return a version ID; inspect Cloudflare before retrying");
  return candidate;
}
mkdirSync(new URL("../artifacts/deployment/", import.meta.url), { recursive: true });
const receipt = { sha, previous: null, candidate: null, rollback: null, pass: false };
try {
  await release(
    {
      version,
      smoke,
      deploy,
      rollback: (previous) =>
        run(
          "--filter",
          "@kanbun/worker",
          "exec",
          "wrangler",
          "rollback",
          previous,
          "--config",
          "wrangler.preview.json",
          "--yes",
        ),
    },
    receipt,
  );
} finally {
  writeFileSync(new URL("../artifacts/deployment/receipt.json", import.meta.url), JSON.stringify(receipt, null, 2));
}
