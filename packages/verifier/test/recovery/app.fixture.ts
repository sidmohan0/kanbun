import { test as base, expect } from "@playwright/test";
import { startWorkspaceRuntime } from "@kanbun/worker/testing";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = fileURLToPath(new URL("../../../../apps/web", import.meta.url));
type Runtime = Awaited<ReturnType<typeof startWorkspaceRuntime>>;

export type AppHarness = {
  origin: string;
  teamId: string;
  issueId: string;
  runtime: Runtime;
};

export const test = base.extend<{ app: AppHarness }>({
  // Playwright requires an object pattern to declare fixture dependencies.
  // eslint-disable-next-line no-empty-pattern
  app: async ({}, use, testInfo) => {
    const runtime = await startWorkspaceRuntime({ localDev: true });
    const temporary = await mkdtemp(path.join(tmpdir(), "kanbun-product-ui-"));
    let vite: Awaited<ReturnType<typeof createServer>> | undefined;
    try {
      const { teamId, issueId } = await runtime.seed();
      // Load the product's own React configuration, index.html, and entry point.
      vite = await createServer({
        configFile: path.join(webRoot, "vite.config.ts"),
        root: webRoot,
        cacheDir: path.join(temporary, "vite-cache"),
        server: {
          port: 0,
          strictPort: false,
          host: "127.0.0.1",
          hmr: false,
          ws: false,
          proxy: { "/sync": runtime.origin, "/__local": runtime.origin },
        },
      });
      await vite.listen();
      const address = vite.httpServer?.address();
      if (!address || typeof address === "string") throw new Error("Product Vite listener did not start");
      await use({ origin: `http://127.0.0.1:${address.port}`, teamId, issueId, runtime });
    } finally {
      try {
        if (testInfo.status !== testInfo.expectedStatus) {
          await testInfo.attach("product-ui-authority-state", {
            body: JSON.stringify(await runtime.inspect(), null, 2),
            contentType: "application/json",
          });
        }
      } finally {
        await vite?.close();
        await runtime.close();
        await rm(temporary, { recursive: true, force: true });
      }
    }
  },
});

export { expect };

export const syncApi = (url: URL) => url.pathname.startsWith("/sync/");
