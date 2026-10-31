import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { startEmailRuntime, emailLink } from "@kanbun/worker/testing";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startProductServer } from "./app.fixture";

type Runtime = Awaited<ReturnType<typeof startEmailRuntime>>;
export type EmailHarness = { origin: string; runtime: Runtime };
const challengeScript = `window.turnstile = {
  render(element, options) { queueMicrotask(() => options.callback("fixture-human-token")); return "fixture-widget"; },
  reset() {}, remove() {}
};`;
export async function nativeBrowser(context: BrowserContext) {
  await context.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: challengeScript,
    }),
  );
}
export async function requestEmail(page: Page, app: EmailHarness, email: string, destination = "#issues") {
  const before = (await app.runtime.capturedEmails()).length;
  await page.goto(`${app.origin}/${destination}`);
  await expect(page.getByRole("heading", { name: "Sign in to kanbun", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Email address", exact: true }).fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible();
  await expect.poll(async () => (await app.runtime.capturedEmails()).length).toBe(before + 1);
  return emailLink((await app.runtime.capturedEmails()).at(-1)!);
}
export async function consumeEmail(page: Page, app: EmailHarness, email: string, link: URL) {
  await page.goto(`${app.origin}/${link.hash}`);
  await expect(page.getByRole("button", { name: `Sign in as ${email}`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Sign in as ${email}`, exact: true }).click();
}
export async function loginEmail(
  page: Page,
  app: EmailHarness,
  email = app.runtime.ownerEmail,
  destination = "#issues",
) {
  const link = await requestEmail(page, app, email, destination);
  await consumeEmail(page, app, email, link);
  await expect(page.locator(".sync-indicator")).toContainText("Saved");
}
export const test = base.extend<{ emailApp: EmailHarness }>({
  // eslint-disable-next-line no-empty-pattern
  emailApp: async ({}, use) => {
    const runtime = await startEmailRuntime();
    const temporary = await mkdtemp(path.join(tmpdir(), "kanbun-email-ui-"));
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
export { expect };
