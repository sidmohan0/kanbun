import { test as base, expect } from "@playwright/test";
import { startPreviewRuntime } from "@kanbun/worker/testing";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { startProductServer } from "./app.fixture";

type PreviewRuntime = Awaited<ReturnType<typeof startPreviewRuntime>>;

export const test = base.extend<{
  preview: { origin: string; runtime: PreviewRuntime; ownerToken: string; setToken(token: string): void };
}>({
  // Playwright requires an object pattern to declare fixture dependencies.
  // eslint-disable-next-line no-empty-pattern
  preview: async ({}, use, testInfo) => {
    const runtime = await startPreviewRuntime();
    const temporary = await mkdtemp(path.join(tmpdir(), "kanbun-authenticated-ui-"));
    let product: Awaited<ReturnType<typeof startProductServer>> | undefined;
    try {
      const ownerToken = await runtime.token();
      let token = ownerToken;
      product = await startProductServer(runtime.origin, path.join(temporary, "vite-cache"), {
        token: () => token,
        appOrigin: runtime.appOrigin,
      });
      await use({
        origin: product.origin,
        runtime,
        ownerToken,
        setToken(value) {
          token = value;
        },
      });
    } finally {
      try {
        if (testInfo.status !== testInfo.expectedStatus)
          await testInfo.attach("authenticated-ui-authority-state", {
            body: JSON.stringify(
              await runtime.inspect().catch((error: unknown) => ({
                inspectionError: error instanceof Error ? error.message : String(error),
              })),
              null,
              2,
            ),
            contentType: "application/json",
          });
      } finally {
        await product?.server.close();
        await runtime.close();
        await rm(temporary, { recursive: true, force: true });
      }
    }
  },
});

export { expect };
