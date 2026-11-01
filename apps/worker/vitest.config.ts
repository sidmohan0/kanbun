import { defineConfig } from "vitest/config";

// Each file starts an isolated workerd. Keep shared local containers responsive;
// CI can run two files at once without relying on a runner's default worker count.
const ci = process.env.CI === "true";
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], fileParallelism: ci, ...(ci ? { maxWorkers: 2 } : {}) },
});
