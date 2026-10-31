import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const artifacts = process.env["KANBUN_RECOVERY_ARTIFACTS"];
const workers = process.env["KANBUN_RECOVERY_WORKERS"];
if (workers !== undefined && (!/^[1-9]\d*$/u.test(workers) || !Number.isSafeInteger(Number(workers))))
  throw new Error("KANBUN_RECOVERY_WORKERS must be a positive integer.");
if (!artifacts || !path.isAbsolute(artifacts))
  throw new Error("Run browser recovery tests with pnpm test:recovery to retain container-local artifacts.");

export default defineConfig({
  testDir: directory,
  testMatch: "*.spec.ts",
  fullyParallel: true,
  ...(workers === undefined ? {} : { workers: Number(workers) }),
  outputDir: path.join(artifacts, "test-results"),
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(artifacts, "results.json") }],
    ["html", { outputFolder: path.join(artifacts, "report"), open: "never" }],
  ],
  use: { browserName: "chromium", trace: "retain-on-failure" },
});
