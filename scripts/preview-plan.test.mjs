import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { previewPlan } from "./preview-plan.mjs";

test("PR deployment planning detects migration and binding changes without any provider credentials", (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "kanbun-preview-plan-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = (file, value) => {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    writeFileSync(path.join(cwd, file), value);
  };
  const commit = () => {
    git("add", ".");
    git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "fixture");
    return git("rev-parse", "HEAD");
  };
  git("init");
  write("apps/worker/wrangler.preview.json", JSON.stringify({ vars: { AUTH_MODE: "email" } }));
  const base = commit();
  write("app.ts", "// code-only change\n");
  commit();
  assert.match(previewPlan(base, { cwd }), /Code-only change/);
  write("packages/model/migrations/accounts/new.sql", "SELECT 1;\n");
  commit();
  assert.match(previewPlan(base, { cwd }), /separate compatible schema/);
  git("rm", "packages/model/migrations/accounts/new.sql");
  write("apps/worker/wrangler.preview.json", JSON.stringify({ vars: { AUTH_MODE: "preview" } }));
  commit();
  assert.match(previewPlan(base, { cwd }), /separate compatible schema/);
  assert.throws(() => previewPlan("main", { cwd }), /base commit SHA/);
  assert.throws(() => previewPlan("0".repeat(40), { cwd }));
});
