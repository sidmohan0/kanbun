import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHarness, type Unstable_RawConfig } from "wrangler";

const sourceRoot = fileURLToPath(new URL("..", import.meta.url));
export async function localWorkerConfig(): Promise<Unstable_RawConfig> {
  return JSON.parse(await readFile(new URL("../wrangler.json", import.meta.url), "utf8")) as Unstable_RawConfig;
}

/** Keep Wrangler's generated middleware and bundles off the host workspace bind mount. */
export async function createRuntimeHarness(workers: Unstable_RawConfig[]) {
  const root = await mkdtemp(join(tmpdir(), "kanbun-worker-runtime-"));
  try {
    const harness = createTestHarness({
      root,
      workers: workers.map((config) => ({
        config: {
          ...config,
          ...(config.main ? { main: resolve(sourceRoot, config.main) } : {}),
          tsconfig: resolve(sourceRoot, config.tsconfig ?? "tsconfig.json"),
          ...(config.d1_databases
            ? {
                d1_databases: config.d1_databases.map((database) => ({
                  ...database,
                  ...(database.migrations_dir ? { migrations_dir: resolve(sourceRoot, database.migrations_dir) } : {}),
                })),
              }
            : {}),
        },
      })),
    });
    const close = harness.close.bind(harness);
    harness.close = async () => {
      try {
        await close();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    };
    return harness;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
