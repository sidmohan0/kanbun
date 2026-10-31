import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  environmentConfig,
  installationConfig,
  installationPlan,
  validateInstallation,
  workspaceId,
} from "./install-cloudflare.mjs";

const template = JSON.parse(readFileSync(new URL("../wrangler.json", import.meta.url)));
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

test("portable template has no hosted identity and only permits an inert setup stage before provisioning", () => {
  assert.deepEqual(validateInstallation(template, { allowSetup: true, provisioned: false }), {
    stage: "setup",
    ready: false,
  });
  assert.throws(() => validateInstallation(template, { allowSetup: true }), /provisioned D1/);
  assert.throws(() => validateInstallation(template, { provisioned: false }), /APP_ORIGIN/);
  assert(!JSON.stringify(template).includes("datafog"));
  assert(!JSON.stringify(template).includes("kanbun.ai"));
  assert(!template.account_id);
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
  assert.equal(template.vars.PREVIEW_OWNER_EMAIL, "");
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
