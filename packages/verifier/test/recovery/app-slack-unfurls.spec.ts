import { test, expect, loginEmail, nativeBrowser } from "./app-slack-unfurls.fixture";

test("connects preview permissions and persists the owner's Slack unfurl preference", async ({
  browser,
  emailApp: app,
}) => {
  const context = await browser.newContext();
  await nativeBrowser(context);
  const page = await context.newPage();
  try {
    await context.route("https://slack.com/oauth/v2/authorize?**", (route) => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get("scope")).toBe("chat:write,links:read,links:write");
      return route.fulfill({
        status: 302,
        headers: {
          location: `${app.origin}/api/integrations/slack/callback?code=fixture&state=${encodeURIComponent(url.searchParams.get("state")!)}`,
        },
      });
    });
    await loginEmail(page, app, app.runtime.ownerEmail, "#settings/integrations");
    const settings = page.getByRole("region", { name: "Slack connection", exact: true });
    await settings.getByRole("button", { name: "Connect Slack", exact: true }).click();
    await expect(settings).toContainText("Connected to Example workspace");
    const enabled = settings.getByRole("checkbox", { name: "Preview public issue links in Slack", exact: true });
    await expect(enabled).toBeChecked();
    await enabled.uncheck();
    await expect(settings.getByRole("button", { name: "Update Slack authorization", exact: true })).toBeEnabled();
    await page.reload();
    await expect(enabled).not.toBeChecked();
    await enabled.check();
    await expect(settings.getByRole("button", { name: "Update Slack authorization", exact: true })).toBeEnabled();
    await page.reload();
    await expect(enabled).toBeChecked();
  } finally {
    await context.close();
  }
});
