import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const artifacts = process.env["KANBUN_RECOVERY_ARTIFACTS"];
const requestedWorkers = process.env["KANBUN_RECOVERY_WORKERS"];
if (
  requestedWorkers !== undefined &&
  (!/^[1-9]\d*$/.test(requestedWorkers) || !Number.isSafeInteger(Number(requestedWorkers)))
)
  throw new Error("KANBUN_RECOVERY_WORKERS must be a positive safe integer.");
if (!artifacts || !path.isAbsolute(artifacts))
  throw new Error("Run browser recovery tests with pnpm test:recovery to retain container-local artifacts.");

export default defineConfig({
  testDir: directory,
  testMatch: "*.spec.ts",
  // PRs retain functional recovery cases; the 5,000-issue benchmark runs on main.
  ...(process.env["KANBUN_SKIP_SCALE"] === "1" ||
  (process.env["CI"] === "true" && process.env["GITHUB_EVENT_NAME"] === "pull_request")
    ? { testIgnore: "**/app-scale.spec.ts" }
    : {}),
  fullyParallel: true,
  ...(requestedWorkers === undefined
    ? process.env["CI"] === "true"
      ? { workers: 3 }
      : {}
    : { workers: Number(requestedWorkers) }),
  outputDir: path.join(artifacts, "test-results"),
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(artifacts, "results.json") }],
    ["html", { outputFolder: path.join(artifacts, "report"), open: "never" }],
  ],
  use: { browserName: "chromium", trace: "retain-on-failure" },
});
