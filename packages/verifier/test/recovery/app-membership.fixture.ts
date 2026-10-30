import { test as base, expect, type BrowserContext } from "@playwright/test";
import { startPreviewRuntime } from "@kanbun/worker/testing";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { startProductServer } from "./app.fixture";

type Runtime = Awaited<ReturnType<typeof startPreviewRuntime>>;
export type MembershipHarness = {
  origin: string;
  runtime: Runtime;
  ownerToken: string;
  memberToken: string;
  outsiderToken: string;
  memberEmail: string;
};
export async function selectPrincipal(
  context: BrowserContext,
  origin: string,
  principal: "owner" | "member" | "outsider",
) {
  // This fixture-only cookie selects an actual signed JWT in the private test proxy.
  // The Worker still verifies its signature, issuer, audience, subject, and directory membership.
  await context.addCookies([{ name: "kanbun-test-principal", value: principal, url: origin }]);
}
export const test = base.extend<{ membership: MembershipHarness }>({
  // eslint-disable-next-line no-empty-pattern
  membership: async ({}, use) => {
    const runtime = await startPreviewRuntime();
    const temporary = await mkdtemp(path.join(tmpdir(), "kanbun-membership-ui-"));
    let product: Awaited<ReturnType<typeof startProductServer>> | undefined;
    try {
      const ownerToken = await runtime.token();
      const memberEmail = "member@example.com";
      const memberToken = await runtime.token({
        sub: "access-member-subject",
        email: memberEmail,
        name: "Preview member",
      });
      const outsiderToken = await runtime.token({
        sub: "access-outsider-subject",
        email: "outsider@example.com",
        name: "Outsider",
      });
      const tokens = { owner: ownerToken, member: memberToken, outsider: outsiderToken };
      product = await startProductServer(runtime.origin, path.join(temporary, "vite-cache"), {
        token(request) {
          const selected = /(?:^|;\s*)kanbun-test-principal=(owner|member|outsider)(?:;|$)/.exec(
            request?.headers.cookie ?? "",
          )?.[1];
          return tokens[selected as keyof typeof tokens] ?? outsiderToken;
        },
        appOrigin: runtime.appOrigin,
      });
      await use({ origin: product.origin, runtime, ownerToken, memberToken, outsiderToken, memberEmail });
    } finally {
      await product?.server.close();
      await runtime.close();
      await rm(temporary, { recursive: true, force: true });
    }
  },
});
export { expect };
