import { startEmailRuntime } from "@kanbun/worker/testing";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startProductServer } from "./app.fixture";
import { test as emailTest } from "./app-email.fixture";

export const test = emailTest.extend({
  // eslint-disable-next-line no-empty-pattern
  emailApp: async ({}, use) => {
    const runtime = await startEmailRuntime({
      sheetsConfig: {
        GOOGLE_SHEETS_CLIENT_ID: "fixture-google-client",
        GOOGLE_SHEETS_CLIENT_SECRET: "fixture-google-secret",
        GOOGLE_SHEETS_TOKEN_KEY: Buffer.alloc(32, 7).toString("base64"),
      },
    });
    const temporary = await mkdtemp(path.join(tmpdir(), "kanbun-sheets-ui-"));
    let product: Awaited<ReturnType<typeof startProductServer>> | undefined;
    try {
      product = await startProductServer(runtime.origin, path.join(temporary, "vite"), {
        appOrigin: runtime.appOrigin,
      });
      await use({ origin: product.origin, runtime });
    } finally {
      await product?.server.close();
      await runtime.close();
      await rm(temporary, { recursive: true, force: true });
    }
  },
});
export { expect, loginEmail, nativeBrowser } from "./app-email.fixture";
