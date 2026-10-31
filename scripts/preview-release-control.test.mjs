import { test } from "node:test";
import assert from "node:assert/strict";
import { release, assertCompatibleSchema, SupersededRelease } from "./preview-release-control.mjs";
import { readFileSync } from "node:fs";

test("code-only releases keep rollback safe while schema and storage changes require review", () => {
  const config = JSON.parse(readFileSync(new URL("../apps/worker/wrangler.preview.json", import.meta.url)));
  assert.doesNotThrow(() =>
    assertCompatibleSchema("", config, {
      ...config,
      observability: { ...config.observability, head_sampling_rate: 0.5 },
    }),
  );
  assert.throws(
    () => assertCompatibleSchema("packages/model/migrations/workspace/new.sql", config, config),
    /separate compatible rollout/,
  );
  for (const key of [
    "migrations",
    "d1_databases",
    "durable_objects",
    "r2_buckets",
    "version_metadata",
    "vars",
    "routes",
  ]) {
    assert.throws(() => assertCompatibleSchema("", config, { ...config, [key]: [] }), /separate compatible rollout/);
  }
});
function scenario({ fail = false, concurrent = false } = {}) {
  let active = "previous";
  const events = [];
  return {
    events,
    hooks: {
      version: async () => active,
      deploy: async () => {
        active = "candidate";
        events.push("deploy");
        return "candidate";
      },
      smoke: async (version) => {
        events.push("check:" + version);
        if (version === "candidate" && fail) {
          if (concurrent) active = "another-release";
          throw new Error("bad candidate");
        }
      },
      rollback: async (version) => {
        events.push("rollback:" + version);
        active = version;
      },
    },
  };
}
test("successful checks leave the candidate active", async () => {
  const s = scenario();
  const receipt = {};
  await release(s.hooks, receipt);
  assert.equal(receipt.pass, true);
  assert.deepEqual(s.events, ["deploy", "check:candidate"]);
});
test("failed candidate restores and verifies the exact prior version while reporting failure", async () => {
  const s = scenario({ fail: true });
  const receipt = {};
  await assert.rejects(release(s.hooks, receipt), /bad candidate/);
  assert.equal(receipt.rollback, "previous");
  assert.notEqual(receipt.pass, true);
  assert.deepEqual(s.events, ["deploy", "check:candidate", "rollback:previous", "check:previous"]);
});
test("a newer concurrent deployment is never overwritten", async () => {
  const s = scenario({ fail: true, concurrent: true });
  await assert.rejects(release(s.hooks, {}), /bad candidate/);
  assert.deepEqual(s.events, ["deploy", "check:candidate"]);
});

test("an upload failure without a known candidate never rolls back an unrelated version", async () => {
  const s = scenario();
  s.hooks.deploy = async () => {
    throw new Error("upload failed");
  };
  await assert.rejects(release(s.hooks, {}), /upload failed/);
  assert.deepEqual(s.events, []);
});

test("a deployment replaced before its first check is not mistaken for our candidate", async () => {
  const s = scenario();
  const deploy = s.hooks.deploy;
  s.hooks.deploy = async () => {
    await deploy();
    return "our-other-version";
  };
  await assert.rejects(release(s.hooks, {}), /not the active version/);
  assert.deepEqual(s.events, ["deploy"]);
});

test("failed rollback records recovery failure and preserves the original release failure", async () => {
  const s = scenario({ fail: true });
  const receipt = {};
  s.hooks.rollback = async () => {
    throw new Error("control plane unavailable");
  };
  await assert.rejects(release(s.hooks, receipt), /bad candidate/);
  assert.equal(receipt.recoveryError, "control plane unavailable");
  assert.notEqual(receipt.rollback, "previous");
});

test("a superseded candidate is a recorded no-op without publishing or rollback", async () => {
  const s = scenario();
  s.hooks.deploy = async () => {
    throw new SupersededRelease();
  };
  const receipt = { pass: false, candidate: null };
  await release(s.hooks, receipt);
  assert.equal(receipt.skipped, "superseded");
  assert.equal(receipt.pass, false);
  assert.equal(receipt.candidate, null);
  assert.deepEqual(s.events, []);
});
