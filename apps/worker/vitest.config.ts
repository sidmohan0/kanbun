import { defineConfig } from "vitest/config";

// Each file starts workerd; avoid competing runtimes in the shared devcontainer.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], fileParallelism: false } });
