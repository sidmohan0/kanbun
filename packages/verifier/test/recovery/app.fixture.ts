import { test as base, expect, type Page } from "@playwright/test";
import type { PersistedState } from "@kanbun/sync/client";
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

export async function startProductServer(
  origin: string,
  cacheDir: string,
  authenticated?: { token(): string; appOrigin: string },
) {
  let browserOrigin = "";
  const server = await createServer({
    configFile: path.join(webRoot, "vite.config.ts"),
    root: webRoot,
    cacheDir,
    server: {
      port: 0,
      strictPort: false,
      host: "127.0.0.1",
      hmr: false,
      proxy: {
        "/sync": {
          target: origin,
          ws: true,
          configure(proxy) {
            if (!authenticated) return;
            const authorize = (
              request: import("node:http").ClientRequest,
              incoming: import("node:http").IncomingMessage,
            ) => {
              request.setHeader("Cf-Access-Jwt-Assertion", authenticated.token());
              // Only this genuine browser origin is translated to the HTTPS edge origin.
              if (incoming.headers.origin === browserOrigin) request.setHeader("Origin", authenticated.appOrigin);
            };
            proxy.on("proxyReq", authorize);
            proxy.on("proxyReqWs", authorize);
          },
        },
        "/api": {
          target: origin,
          configure(proxy) {
            if (authenticated)
              proxy.on("proxyReq", (request) => request.setHeader("Cf-Access-Jwt-Assertion", authenticated.token()));
          },
        },
        "/__local": origin,
      },
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Product Vite listener did not start");
  browserOrigin = `http://127.0.0.1:${address.port}`;
  return { server, origin: browserOrigin };
}

export async function readWorkspaceState(page: Page, key: string): Promise<PersistedState | undefined> {
  return page.evaluate(async (recordKey) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("kanbun");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<PersistedState | undefined>((resolve, reject) => {
        const request = db.transaction("state", "readonly").objectStore("state").get(recordKey);
        request.onsuccess = () => resolve(request.result as PersistedState | undefined);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, key);
}

export const test = base.extend<{ app: AppHarness; seedWorkspace: boolean }>({
  seedWorkspace: [true, { option: true }],
  app: async ({ seedWorkspace }, use, testInfo) => {
    const runtime = await startWorkspaceRuntime({ localDev: true });
    const temporary = await mkdtemp(path.join(tmpdir(), "kanbun-product-ui-"));
    let vite: Awaited<ReturnType<typeof createServer>> | undefined;
    try {
      const { teamId, issueId } = seedWorkspace ? await runtime.seed() : { teamId: "", issueId: "" };
      // Load the product's own React configuration, index.html, and entry point.
      const product = await startProductServer(runtime.origin, path.join(temporary, "vite-cache"));
      vite = product.server;
      await use({ origin: product.origin, teamId, issueId, runtime });
    } finally {
      try {
        if (testInfo.status !== testInfo.expectedStatus) {
          await testInfo.attach("product-ui-authority-state", {
            body: JSON.stringify(
              await runtime.inspect().catch((error: unknown) => ({
                inspectionError: error instanceof Error ? error.message : String(error),
              })),
              null,
              2,
            ),
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
