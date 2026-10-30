import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const artifacts = path.resolve(directory, "../../../../artifacts/recovery");

export default defineConfig({
  testDir: directory,
  testMatch: "*.spec.ts",
  fullyParallel: true,
  outputDir: path.join(artifacts, "test-results"),
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(artifacts, "results.json") }],
    ["html", { outputFolder: path.join(artifacts, "report"), open: "never" }],
  ],
  use: { browserName: "chromium", trace: "retain-on-failure" },
});
