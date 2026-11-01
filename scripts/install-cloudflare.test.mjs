import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  deploymentSourceCommit,
  environmentConfig,
  installationConfig,
  installationPlan,
  publicSettings,
  validateInstallation,
  workspaceId,
} from "./install-cloudflare.mjs";

const rootProfile = JSON.parse(readFileSync(new URL("../wrangler.json", import.meta.url)));
// Installation functions are exercised against an explicit unconfigured fixture so that
// Cloudflare-provisioned IDs and deliberately configured forks do not change these cases.
const template = structuredClone(rootProfile);
template.name = "kanbun";
delete template.account_id;
delete template.routes;
template.workers_dev = true;
template.vars = { LOCAL_DEV: "false", AUTH_MODE: "email", INSTALLATION_STAGE: "setup" };
const accounts = template.d1_databases.find((binding) => binding.binding === "ACCOUNTS");
accounts.database_name = "kanbun-accounts";
accounts.database_id = "00000000-0000-0000-0000-000000000000";
template.r2_buckets.find((binding) => binding.binding === "BACKUPS").bucket_name = "kanbun-backups";
const settings = {
  name: "kanbun-independent",
  account_id: "a".repeat(32),
  origin: "https://kanbun-independent.team.workers.dev",
  owner_email: "owner@acme.dev",
  email_domain: "acme.dev",
  from_email: "Kanbun <signin@auth.acme.dev>",
  turnstile_site_key: "0x4AAAAAAAcustomerSiteKey",
  workspace_name: "Acme",
  database_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  database_name: "acme-accounts",
  backup_bucket: "acme-backups",
};
const configured = () => installationConfig(template, settings);

test("the installer CLI configures and checks a fresh checkout while keeping profiles in its root", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "kanbun install cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, "scripts"));
  const script = path.join(directory, "scripts/install-cloudflare.mjs");
  writeFileSync(script, readFileSync(new URL("./install-cloudflare.mjs", import.meta.url)));
  writeFileSync(path.join(directory, "wrangler.json"), JSON.stringify(template));
  writeFileSync(path.join(directory, "settings.json"), JSON.stringify(settings));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !publicSettings.includes(key)));
  const cli = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: directory, encoding: "utf8", env });
  const setup = cli("check");
  assert.equal(setup.status, 0, setup.stderr);
  assert.equal(JSON.parse(setup.stdout).stage, "setup");
  const args = ["configure", "--settings", "settings.json", "--output", "wrangler.install.json"];
  const first = cli(...args);
  assert.equal(first.status, 0, first.stderr);
  const profile = path.join(directory, "wrangler.install.json");
  const original = readFileSync(profile, "utf8");
  const second = cli(...args);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(profile, "utf8"), original, "Rerunning configure must retain the workspace identity");
  const check = cli("check", "--config", "wrangler.install.json");
  assert.equal(check.status, 0, check.stderr);
  const plan = JSON.parse(check.stdout);
  assert.equal(plan.ready, true);
  assert.equal(plan.worker, settings.name);
  assert.equal(plan.database, settings.database_name);
  const outside = path.join(directory, "nested", "outside.json");
  const rejectedConfig = cli("check", "--config", "nested/outside.json");
  assert.equal(rejectedConfig.status, 1);
  assert.match(rejectedConfig.stderr, /configuration must be in the repository root/);
  const rejectedOutput = cli("configure", "--settings", "settings.json", "--output", "nested/outside.json");
  assert.equal(rejectedOutput.status, 1);
  assert.match(rejectedOutput.stderr, /separate installation profile in the repository root/);
  assert.equal(existsSync(outside), false);
});

test("the root profile omits unset setup inputs or passes full configured-installation safety", () => {
  if (rootProfile.vars?.INSTALLATION_STAGE === "setup") {
    for (const key of publicSettings)
      assert.equal(
        Object.hasOwn(rootProfile.vars, key),
        false,
        `${key} must be configured after the inert setup deployment`,
      );
    assert.deepEqual(validateInstallation(rootProfile, { allowSetup: true, provisioned: false }), {
      stage: "setup",
      ready: false,
    });
  } else {
    assert.deepEqual(validateInstallation(rootProfile), { stage: "ready", ready: true });
  }
});

test("the runtime-secret example contains guidance without generated wizard credentials", () => {
  const lines = readFileSync(new URL("../.dev.vars.example", import.meta.url), "utf8").split(/\r?\n/);
  assert.equal(
    lines.filter((line) => line.trim() && !line.trim().startsWith("#")).length,
    0,
    "Keep .dev.vars.example comments-only; active assignments become prefilled deploy-button secret inputs.",
  );
  for (const name of ["RESEND_API_KEY", "TURNSTILE_SECRET_KEY"])
    assert.ok(
      lines.some((line) => new RegExp(`^#\\s*${name}:`).test(line)),
      `Document ${name} setup without a credential value`,
    );
});

test("portable template has no hosted identity and only permits an inert setup stage before provisioning", () => {
  assert.deepEqual(validateInstallation(template, { allowSetup: true, provisioned: false }), {
    stage: "setup",
    ready: false,
  });
  const unprovisioned = structuredClone(template);
  unprovisioned.d1_databases.find((binding) => binding.binding === "ACCOUNTS").database_id =
    "00000000-0000-0000-0000-000000000000";
  assert.throws(() => validateInstallation(unprovisioned, { allowSetup: true }), /provisioned D1/);
  assert.throws(() => validateInstallation(template, { provisioned: false }), /APP_ORIGIN/);
  assert(!JSON.stringify(template).includes("datafog"));
  assert(!JSON.stringify(template).includes("kanbun.ai"));
  assert(!template.account_id);
});

test("omitted or empty identity values are accepted only in the explicit inert setup mode", () => {
  const options = { allowSetup: true, provisioned: false };
  const empty = structuredClone(template);
  empty.vars.APP_ORIGIN = "";
  empty.vars.AUTH_EMAIL_DOMAIN = "";
  assert.deepEqual(validateInstallation(empty, options), { stage: "setup", ready: false });
  for (const key of publicSettings) {
    const partial = structuredClone(template);
    partial.vars[key] = "nonempty-incomplete-setting";
    assert.throws(() => validateInstallation(partial, options));
  }
  for (const change of [
    (config) => {
      config.vars.INSTALLATION_STAGE = "ready";
    },
    (config) => {
      delete config.vars.INSTALLATION_STAGE;
    },
    (config) => {
      config.vars.LOCAL_DEV = "true";
    },
    (config) => {
      config.workers_dev = false;
    },
    (config) => {
      config.routes = [{ pattern: "unexpected.acme.dev", custom_domain: true }];
    },
  ]) {
    const unsafe = structuredClone(template);
    change(unsafe);
    assert.throws(() => validateInstallation(unsafe, options));
  }
});

test("configuration creates installer-owned state and reruns preserve workspace identity", () => {
  const first = configured();
  assert.match(workspaceId(), /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  const second = installationConfig(template, settings, first);
  assert.deepEqual(second, first);
  assert.equal(installationPlan(first).ready, true);
  assert.equal(installationPlan(first).database, "acme-accounts");
  assert.throws(
    () => installationConfig(template, { ...settings, workspace_name: "Changed" }, first),
    /not overwritten/,
  );
  assert.throws(
    () => installationConfig(template, { ...settings, RESEND_API_KEY: "secret" }),
    /Unknown installation setting/,
  );
});

test("custom hostname closes alternate URL and rejects origin mismatches", () => {
  const config = installationConfig(template, { ...settings, origin: "https://work.acme.dev" });
  assert.equal(config.workers_dev, false);
  assert.deepEqual(config.routes, [{ pattern: "work.acme.dev", custom_domain: true }]);
  config.routes[0].pattern = "other.acme.dev";
  assert.throws(() => validateInstallation(config), /exact APP_ORIGIN/);
  const alternate = configured();
  alternate.vars.APP_ORIGIN = "https://another.team.workers.dev";
  assert.throws(() => validateInstallation(alternate), /exact Worker's origin/);
});

test("unsafe modes, fixture transports, recovery flags, placeholder values, and test keys fail closed", () => {
  const changes = [
    (c) => {
      c.vars.LOCAL_DEV = "true";
    },
    (c) => {
      c.preview_urls = true;
    },
    (c) => {
      c.vars.AUTH_EMAIL_TRANSPORT = "test";
    },
    (c) => {
      c.vars.BACKUP_RESTORE_ISOLATED = "true";
    },
    (c) => {
      c.vars.RESEND_API_KEY = "secret";
    },
    (c) => {
      c.vars.TURNSTILE_SITE_KEY = "0x4AAAAAAABtest";
    },
    (c) => {
      c.vars.APP_ORIGIN = "https://example.com";
    },
    (c) => {
      c.vars.PREVIEW_OWNER_EMAIL = "owner@other.dev";
    },
    (c) => {
      c.vars.PREVIEW_WORKSPACE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    },
    (c) => {
      c.assets.run_worker_first = false;
    },
  ];
  for (const change of changes) {
    const config = configured();
    change(config);
    assert.throws(() => validateInstallation(config));
  }
});

test("build environment accepts public inputs only and cannot turn a partial configuration into a deployable setup shell", () => {
  const config = configured();
  const env = { ...config.vars, RESEND_API_KEY: "private-secret", LOCAL_DEV: "true" };
  const merged = environmentConfig(template, env);
  merged.d1_databases[0] = config.d1_databases[0];
  merged.name = config.name;
  assert.equal(validateInstallation(merged).ready, true);
  assert.equal(merged.vars.LOCAL_DEV, "false");
  assert(!JSON.stringify(merged).includes("private-secret"));
  const partial = environmentConfig(template, { PREVIEW_OWNER_EMAIL: "owner@acme.dev" });
  assert.throws(() => validateInstallation(partial, { allowSetup: true, provisioned: false }), /APP_ORIGIN/);
  assert.equal(template.vars.PREVIEW_OWNER_EMAIL, undefined);
});

test("configuration rejects malformed email domains and mailbox forms before reaching runtime", () => {
  for (const email_domain of ["bad..dev", "-bad.dev", "bad_.dev", "bad.123", "bad dev", "bad@dev"]) {
    assert.throws(
      () =>
        installationConfig(template, {
          ...settings,
          email_domain,
          owner_email: `owner@${email_domain}`,
        }),
      /owner email/,
    );
  }
  for (const owner_email of [".owner@acme.dev", "owner..name@acme.dev", "owner,name@acme.dev"]) {
    assert.throws(() => installationConfig(template, { ...settings, owner_email }), /owner email/);
  }
  assert.throws(
    () => installationConfig(template, { ...settings, from_email: "Kanbun <sign..in@acme.dev>" }),
    /verified sender/,
  );
  assert.throws(
    () => installationConfig(template, { ...settings, origin: "https://work.acme.dev:8443" }),
    /HTTPS origin/,
  );
});

test("deployment tags identify committed code while generated resource configuration may remain local", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "kanbun-deployment-source-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => deploymentSourceCommit(directory), /Git checkout with an existing committed HEAD/);
  const git = (...args) =>
    execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main");
  assert.throws(() => deploymentSourceCommit(directory), /existing committed HEAD/);
  mkdirSync(path.join(directory, "apps"));
  writeFileSync(path.join(directory, "apps/worker.ts"), "export default {};\n");
  writeFileSync(path.join(directory, "wrangler.json"), "{}\n");
  git("add", ".");
  git("-c", "user.name=Deployment test", "-c", "user.email=deployment@example.com", "commit", "-m", "fixture");
  const sourceCommit = git("rev-parse", "HEAD");
  assert.equal(deploymentSourceCommit(directory), sourceCommit);
  writeFileSync(path.join(directory, "wrangler.json"), '{"database_id":"generated-resource-id"}\n');
  assert.equal(deploymentSourceCommit(directory), sourceCommit);
  const plan = installationPlan(configured(), undefined, sourceCommit);
  assert.equal(plan.sourceCommit, sourceCommit);
  assert.deepEqual(plan.commands[1].slice(-3), ["deploy", "--tag", sourceCommit]);
  assert.equal(plan.commands[0].includes("--tag"), false);
  assert.throws(() => installationPlan(configured(), undefined, "unknown"), /full 40-character source commit/);
  writeFileSync(path.join(directory, "apps/worker.ts"), "export default { changed: true };\n");
  assert.throws(() => deploymentSourceCommit(directory), /Commit application/);
  git("restore", "apps/worker.ts");
  writeFileSync(path.join(directory, "apps/untracked.ts"), "export {};\n");
  assert.throws(() => deploymentSourceCommit(directory), /Commit application/);
});
