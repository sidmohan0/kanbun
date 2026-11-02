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
      slackConfig: {
        SLACK_CLIENT_ID: "123.456",
        SLACK_CLIENT_SECRET: "fixture-client-secret",
        SLACK_APP_ID: "A123",
        SLACK_SIGNING_SECRET: "fixture-slack-signing-secret",
        SLACK_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      },
    });
    const temporary = await mkdtemp(path.join(tmpdir(), "kanbun-slack-ui-"));
    let product: Awaited<ReturnType<typeof startProductServer>> | undefined;
    try {
      await runtime.setGithubResponses([
        {
          host: "slack.com",
          method: "POST",
          path: "/api/oauth.v2.access",
          body: {
            ok: true,
            access_token: "xoxb-fixture-private-token",
            token_type: "bot",
            app_id: "A123",
            scope: "chat:write,links:read,links:write",
            team: { id: "T123", name: "Example workspace" },
            bot_user_id: "U123",
            is_enterprise_install: false,
          },
        },
      ]);
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
