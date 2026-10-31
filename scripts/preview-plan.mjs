import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { assertCompatibleSchema } from "./preview-release-control.mjs";

/** Advisory PR plan; the trusted release still checks the actual deployed version. */
export function previewPlan(base, { cwd = process.cwd() } = {}) {
  if (!/^[a-f0-9]{40}$/i.test(base ?? "")) throw new Error("Preview plan requires a base commit SHA");
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
  const file = "apps/worker/wrangler.preview.json";
  const previous = JSON.parse(git("show", `${base}:${file}`));
  const next = JSON.parse(git("show", `HEAD:${file}`));
  const migrations = git("diff", "--name-only", base, "HEAD", "--", "packages/model/migrations").trim();
  try {
    assertCompatibleSchema(migrations, previous, next);
    return "## Deployment plan\n\nCode-only change: no schema or storage configuration rollout detected.\n";
  } catch {
    return "## Deployment plan\n\nA separate compatible schema or configuration rollout is required before automatic deployment. The release guard will compare against the actual deployed version and block unsafe code rollback.\n";
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  process.stdout.write(previewPlan(process.argv[2]));
