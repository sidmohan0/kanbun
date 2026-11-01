#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const publicSettings = [
  "APP_ORIGIN",
  "AUTH_EMAIL_DOMAIN",
  "AUTH_FROM_EMAIL",
  "TURNSTILE_SITE_KEY",
  "PREVIEW_OWNER_EMAIL",
  "PREVIEW_WORKSPACE_ID",
  "PREVIEW_WORKSPACE_NAME",
];
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const workspace = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const domain = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
function validEmail(value) {
  if (typeof value !== "string") return false;
  const parts = value.split("@");
  return parts.length === 2 && /^[a-z0-9_+'-]+(?:\.[a-z0-9_+'-]+)*$/i.test(parts[0]) && domain.test(parts[1]);
}
const resource = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
const fail = (message) => {
  throw new Error(message);
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const placeholder = (value) =>
  !value || /replace-with|your-company|your-subdomain|example\.(?:com|org|net)/i.test(value);

export function workspaceId() {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = (bytes[6] & 15) | 112;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Shared safety boundary for both configured installs and the button's inert setup shell. */
export function validateInstallation(config, { allowSetup = false, provisioned = true } = {}) {
  if (!resource.test(config.name ?? "")) fail("Set a lowercase Worker name with letters, numbers and hyphens.");
  if (config.vars?.LOCAL_DEV !== "false" || config.vars?.AUTH_MODE !== "email" || config.preview_urls !== false)
    fail("Installation must use email authentication, disabled local identity and disabled version preview URLs.");
  if (
    Object.keys(config.vars).some((name) => /SECRET|PRIVATE_KEY|API_KEY|TRANSPORT|BACKUP_RESTORE|^ACCESS_/.test(name))
  )
    fail("Secrets, test transports and recovery/legacy authentication settings cannot be public install variables.");
  if (
    config.assets?.binding !== "ASSETS" ||
    config.assets?.run_worker_first !== true ||
    config.main !== "apps/worker/src/index.ts"
  )
    fail("Use the maintained Worker entry point and authenticated static asset router.");
  if (config.version_metadata?.binding !== "CF_VERSION_METADATA") fail("Source metadata is required for backups.");
  const bindings = config.durable_objects?.bindings ?? [];
  if (
    !bindings.some((b) => b.name === "WORKSPACES" && b.class_name === "WorkspaceDO") ||
    !bindings.some((b) => b.name === "DOCUMENTS" && b.class_name === "DocumentDO")
  )
    fail("Workspace and document Durable Object bindings are required.");
  const db = config.d1_databases?.find((b) => b.binding === "ACCOUNTS");
  if (!db || !resource.test(db.database_name ?? "") || db.migrations_dir !== "packages/model/migrations/accounts")
    fail("Configure the dedicated ACCOUNTS database and maintained migrations.");
  if (provisioned && (!uuid.test(db.database_id ?? "") || /^0{8}-/.test(db.database_id)))
    fail("ACCOUNTS needs a provisioned D1 database ID; provision it before deploying.");
  if (!config.r2_buckets?.some((b) => b.binding === "BACKUPS" && resource.test(b.bucket_name ?? "")))
    fail("Configure a dedicated private BACKUPS bucket.");
  const blank = publicSettings.every((key) => config.vars[key] === undefined || config.vars[key] === "");
  if (allowSetup && config.vars.INSTALLATION_STAGE === "setup" && blank) {
    if (config.workers_dev !== true || config.routes?.length)
      fail("The setup shell uses only its own workers.dev hostname.");
    return { stage: "setup", ready: false };
  }
  for (const key of publicSettings)
    if (typeof config.vars[key] !== "string" || placeholder(config.vars[key]))
      fail(`Configure ${key} with an installer-owned value.`);
  if (config.vars.INSTALLATION_STAGE !== "ready") fail("Configure the installation before enabling sign-in.");
  const vars = config.vars;
  let origin;
  try {
    origin = new URL(vars.APP_ORIGIN);
  } catch {
    fail("APP_ORIGIN must be an HTTPS origin without a path.");
  }
  if (origin.protocol !== "https:" || origin.port || origin.origin !== vars.APP_ORIGIN)
    fail("APP_ORIGIN must be an HTTPS origin without a path.");
  if (config.workers_dev === true) {
    if (
      config.routes?.length ||
      !origin.hostname.endsWith(".workers.dev") ||
      origin.hostname.split(".").length !== 4 ||
      !origin.hostname.startsWith(`${config.name}.`)
    )
      fail("workers.dev installs must use the exact Worker's origin and no additional route.");
  } else if (
    config.workers_dev !== false ||
    config.routes?.length !== 1 ||
    config.routes[0].custom_domain !== true ||
    config.routes[0].pattern !== origin.hostname
  )
    fail("Custom-domain installs must disable workers.dev and route only the exact APP_ORIGIN hostname.");
  if (
    !domain.test(vars.AUTH_EMAIL_DOMAIN) ||
    !validEmail(vars.PREVIEW_OWNER_EMAIL) ||
    vars.PREVIEW_OWNER_EMAIL.split("@")[1].toLowerCase() !== vars.AUTH_EMAIL_DOMAIN.toLowerCase()
  )
    fail("The owner email must belong to AUTH_EMAIL_DOMAIN.");
  const sender = /^Kanbun <([^<>]+)>$/.exec(vars.AUTH_FROM_EMAIL)?.[1];
  if (!validEmail(sender)) fail("Use a verified sender formatted as Kanbun <address@domain>.");
  if (!/^0x[a-zA-Z0-9_-]+$/.test(vars.TURNSTILE_SITE_KEY) || vars.TURNSTILE_SITE_KEY.startsWith("0x4AAAAAAAB"))
    fail("Configure a production Turnstile site key, not a test key.");
  if (!workspace.test(vars.PREVIEW_WORKSPACE_ID)) fail("Configure a workspace UUIDv7.");
  if (!vars.PREVIEW_WORKSPACE_NAME.trim() || vars.PREVIEW_WORKSPACE_NAME.length > 160)
    fail("Workspace name must contain 1 to 160 characters.");
  return { stage: "ready", ready: true };
}

export function installationConfig(template, settings, previous) {
  const allowed = new Set([
    "name",
    "account_id",
    "origin",
    "owner_email",
    "email_domain",
    "from_email",
    "turnstile_site_key",
    "workspace_name",
    "database_id",
    "database_name",
    "backup_bucket",
    "workspace_id",
  ]);
  if (Object.keys(settings).some((key) => !allowed.has(key)))
    fail("Unknown installation setting; keep secrets in Worker secret storage.");
  const config = clone(template);
  config.name = settings.name;
  if (!/^[a-f0-9]{32}$/i.test(settings.account_id ?? "")) fail("Set the installer's Cloudflare account ID.");
  config.account_id = settings.account_id;
  config.vars = {
    LOCAL_DEV: "false",
    AUTH_MODE: "email",
    INSTALLATION_STAGE: "ready",
    APP_ORIGIN: settings.origin,
    AUTH_EMAIL_DOMAIN: settings.email_domain,
    AUTH_FROM_EMAIL: settings.from_email,
    TURNSTILE_SITE_KEY: settings.turnstile_site_key,
    PREVIEW_OWNER_EMAIL: settings.owner_email,
    PREVIEW_WORKSPACE_ID: settings.workspace_id ?? previous?.vars?.PREVIEW_WORKSPACE_ID ?? workspaceId(),
    PREVIEW_WORKSPACE_NAME: settings.workspace_name,
  };
  config.workers_dev = settings.origin?.endsWith(".workers.dev");
  if (!config.workers_dev) config.routes = [{ pattern: new URL(settings.origin).hostname, custom_domain: true }];
  else delete config.routes;
  config.d1_databases[0].database_id = settings.database_id;
  config.d1_databases[0].database_name = settings.database_name;
  config.r2_buckets[0].bucket_name = settings.backup_bucket;
  validateInstallation(config);
  if (previous && JSON.stringify(previous) !== JSON.stringify(config))
    fail(
      "An installation profile already exists with different settings. Review and edit it explicitly; it was not overwritten.",
    );
  return config;
}

export function environmentConfig(config, environment) {
  const next = clone(config);
  let supplied = false;
  for (const key of publicSettings)
    if (environment[key] !== undefined) {
      next.vars[key] = environment[key];
      supplied = true;
    }
  if (supplied) next.vars.INSTALLATION_STAGE = "ready";
  return next;
}

export function deploymentSourceCommit(directory = root) {
  let sourceCommit, changedCode;
  try {
    sourceCommit = execFileSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    changedCode = execFileSync(
      "git",
      [
        "status",
        "--porcelain",
        "--untracked-files=all",
        "--",
        "apps",
        "packages",
        "scripts",
        "package.json",
        "pnpm-lock.yaml",
      ],
      { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch {
    fail("Cloudflare deployment needs a Git checkout with an existing committed HEAD.");
  }
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) fail("Deployment needs a full 40-character source commit.");
  if (changedCode)
    fail(
      "Commit application, workspace, installer and dependency changes before deployment; generated installation configuration may remain local.",
    );
  return sourceCommit;
}

export function installationPlan(config, options, sourceCommit) {
  const status = validateInstallation(config, options);
  if (sourceCommit !== undefined && !/^[a-f0-9]{40}$/.test(sourceCommit))
    fail("Deployment needs a full 40-character source commit.");
  return {
    ...status,
    ...(sourceCommit === undefined ? {} : { sourceCommit }),
    worker: config.name,
    origin: config.vars.APP_ORIGIN || null,
    database: config.d1_databases.find((b) => b.binding === "ACCOUNTS").database_name,
    backupBucket: config.r2_buckets.find((b) => b.binding === "BACKUPS").bucket_name,
    commands: [
      ["pnpm", "--filter", "@kanbun/worker", "exec", "wrangler", "d1", "migrations", "apply", "ACCOUNTS", "--remote"],
      [
        "pnpm",
        "--filter",
        "@kanbun/worker",
        "exec",
        "wrangler",
        "deploy",
        ...(sourceCommit === undefined ? [] : ["--tag", sourceCommit]),
      ],
    ],
  };
}

function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: "string", default: "wrangler.json" },
      settings: { type: "string", default: "installation.local.json" },
      output: { type: "string", default: "wrangler.install.json" },
      "dry-run": { type: "boolean" },
    },
  });
  const action = positionals[0] ?? "check";
  const configPath = path.resolve(root, values.config);
  // Relative asset and migration paths are intentionally rooted in the repository.
  if (path.dirname(configPath) !== root) fail("Installation configuration must be in the repository root.");
  const template = JSON.parse(readFileSync(configPath, "utf8"));
  if (action === "configure") {
    const output = path.resolve(root, values.output);
    if (path.dirname(output) !== root || output === configPath)
      fail("Write a separate installation profile in the repository root.");
    const previous = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : undefined;
    const settings = JSON.parse(readFileSync(path.resolve(root, values.settings), "utf8"));
    const config = installationConfig(template, settings, previous);
    if (!previous) writeFileSync(output, JSON.stringify(config, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(`Installation configuration ready: ${path.basename(output)}. No remote resources changed.`);
    return;
  }
  if (!["check", "deploy"].includes(action)) fail("Use check, configure or deploy.");
  const config = environmentConfig(template, process.env);
  const options = { allowSetup: values.config === "wrangler.json", provisioned: action === "deploy" };
  const plan = installationPlan(config, options, action === "deploy" ? deploymentSourceCommit() : undefined);
  if (action === "check" || values["dry-run"]) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  const temporary = path.join(root, `.wrangler-install-${process.pid}.json`);
  writeFileSync(temporary, JSON.stringify(config), { flag: "wx", mode: 0o600 });
  try {
    for (const [command, ...args] of plan.commands)
      execFileSync(command, [...args, "--config", temporary], { cwd: root, stdio: "inherit" });
    console.log(
      plan.ready
        ? "Deployment complete. Prove live owner sign-in and member access before adoption."
        : "Setup shell deployed; sign-in and workspace access remain disabled until installation settings and provider secrets are configured. See docs/cloudflare-deployment.md.",
    );
  } finally {
    unlinkSync(temporary);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
