#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const { values } = parseArgs({ options: { sha: { type: "string" }, check: { type: "boolean" } } });
const root = fileURLToPath(new URL("..", import.meta.url));
const config = JSON.parse(readFileSync(new URL("../apps/worker/wrangler.preview.json", import.meta.url)));
const git = (...args) => execFileSync("git", args, { encoding: "utf8", cwd: root }).trim();
const fail = (message) => {
  throw new Error(message);
};

if (!values.sha || !/^[a-f0-9]{40}$/.test(values.sha) || git("rev-parse", "HEAD") !== values.sha)
  fail("Pass --sha with the exact, green-CI commit checked out for deployment.");
if (git("status", "--porcelain")) fail("Deploy from a clean checkout so its source matches the verified commit.");
const vars = config.vars;
if (
  config.workers_dev !== false ||
  config.preview_urls !== false ||
  vars.LOCAL_DEV !== "false" ||
  vars.AUTH_MODE !== "preview" ||
  vars.BACKUP_RESTORE_ISOLATED !== undefined ||
  vars.BACKUP_RESTORE_SOURCE_COMMIT !== undefined ||
  config.assets?.binding !== "ASSETS" ||
  config.assets?.run_worker_first !== true
)
  fail(
    "Preview deployment must require Worker authentication and disable local identity and alternative preview URLs.",
  );
if (!/^[a-f0-9]{64}$/i.test(vars.ACCESS_AUDIENCE)) fail("Configure the hostname Access application's audience.");
if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(vars.ACCESS_ISSUER))
  fail("Configure the exact Cloudflare Access issuer.");
if (typeof vars.PREVIEW_OWNER_EMAIL !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vars.PREVIEW_OWNER_EMAIL))
  fail("Configure the preview owner's email.");
if (!/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(vars.PREVIEW_WORKSPACE_ID))
  fail("Configure the dedicated workspace UUIDv7.");
if (
  typeof vars.PREVIEW_WORKSPACE_NAME !== "string" ||
  !vars.PREVIEW_WORKSPACE_NAME.trim() ||
  vars.PREVIEW_WORKSPACE_NAME.trim().length > 160
)
  fail("Configure the workspace name.");
const origin = new URL(vars.APP_ORIGIN);
if (
  origin.protocol !== "https:" ||
  origin.origin !== vars.APP_ORIGIN ||
  config.routes.length !== 1 ||
  config.routes[0].pattern !== origin.hostname ||
  config.routes[0].custom_domain !== true
)
  fail("Preview routing must use its exact HTTPS custom hostname.");
if (
  !config.d1_databases.some(
    (database) =>
      database.binding === "ACCOUNTS" &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(database.database_id) &&
      database.database_id !== "00000000-0000-0000-0000-000000000000",
  )
)
  fail("Configure the dedicated preview accounts database.");
if (
  !config.r2_buckets?.some((bucket) => bucket.binding === "BACKUPS" && bucket.bucket_name === "kanbun-preview-backups")
)
  fail("Configure the private preview backup bucket.");
if (config.version_metadata?.binding !== "CF_VERSION_METADATA")
  fail("Configure deployed source version metadata for backup recovery.");
if (values.check) {
  console.log(`Preview deployment configuration is ready for ${values.sha}.`);
} else {
  const run = (...args) => execFileSync("pnpm", args, { stdio: "inherit", cwd: root });
  run("build");
  run(
    "--filter",
    "@kanbun/worker",
    "exec",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "ACCOUNTS",
    "--remote",
    "--config",
    "wrangler.preview.json",
  );
  run(
    "--filter",
    "@kanbun/worker",
    "exec",
    "wrangler",
    "deploy",
    "--config",
    "wrangler.preview.json",
    "--tag",
    values.sha,
  );
}
