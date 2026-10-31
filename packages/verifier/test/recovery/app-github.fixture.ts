import { startGithubRuntime } from "@kanbun/worker/testing";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startProductServer } from "./app.fixture";
import { test as emailTest } from "./app-email.fixture";

/** Real native authentication and GitHub API traffic, with only external providers substituted. */
export const test = emailTest.extend({
  // eslint-disable-next-line no-empty-pattern
  emailApp: async ({}, use) => {
    const runtime = await startGithubRuntime();
    const temporary = await mkdtemp(path.join(tmpdir(), "kanbun-github-ui-"));
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
