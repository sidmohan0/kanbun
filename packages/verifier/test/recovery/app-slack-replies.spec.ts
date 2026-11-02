import { test, expect, loginEmail, nativeBrowser } from "./app-slack-unfurls.fixture";

test("owner opts in to public-channel issue replies, authorizes the new scope and controls it independently of unfurls", async ({
  browser,
  emailApp: app,
}) => {
  const context = await browser.newContext();
  await nativeBrowser(context);
  const page = await context.newPage();
  let replies = false;
  try {
    await context.route("https://slack.com/oauth/v2/authorize?**", (route) => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get("scope")).toBe(
        "chat:write,links:read,links:write" + (replies ? ",channels:history" : ""),
      );
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
    const enabled = settings.getByRole("checkbox", {
      name: "Reply to issue IDs in public Slack channels",
      exact: true,
    });
    await expect(enabled).not.toBeChecked();
    await enabled.check();
    const reauthorization = settings.getByText(
      "Update Slack authorization to allow public-channel message events for issue replies.",
      { exact: true },
    );
    await expect(reauthorization).toBeVisible();
    await expect(settings).toContainText("Anyone in the channel can see");
    await page.reload();
    await expect(enabled).toBeChecked();
    await expect(reauthorization).toBeVisible();
    await app.runtime.setGithubResponses([
      {
        host: "slack.com",
        method: "POST",
        path: "/api/oauth.v2.access",
        body: {
          ok: true,
          access_token: "xoxb-fixture-private-token",
          token_type: "bot",
          app_id: "A123",
          scope: "chat:write,links:read,links:write,channels:history",
          team: { id: "T123", name: "Example workspace" },
          bot_user_id: "U123",
          is_enterprise_install: false,
        },
      },
    ]);
    replies = true;
    await settings.getByRole("button", { name: "Update Slack authorization", exact: true }).click();
    await expect(settings).toContainText("Connected to Example workspace");
    await expect(reauthorization).toHaveCount(0);
    const unfurls = settings.getByRole("checkbox", { name: "Preview public issue links in Slack", exact: true });
    await unfurls.uncheck();
    await expect(settings.getByRole("button", { name: "Update Slack authorization", exact: true })).toBeEnabled();
    await page.reload();
    await expect(unfurls).not.toBeChecked();
    await expect(enabled).toBeChecked();
    await enabled.uncheck();
    await expect(settings.getByRole("button", { name: "Update Slack authorization", exact: true })).toBeEnabled();
    await page.reload();
    await expect(enabled).not.toBeChecked();
  } finally {
    await context.close();
  }
});
