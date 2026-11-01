import { nativeAgent, emailLink, linkToken } from "@kanbun/worker/testing";
import { test, expect, loginEmail, nativeBrowser } from "./app-sheets.fixture";

for (const desktop of [false, true]) {
  test(`sync command performs a real export in ${desktop ? "desktop" : "browser"} and reports failures`, async ({
    browser,
    emailApp: app,
  }) => {
    const context = await browser.newContext(desktop ? { userAgent: "KanbunDesktop/1.0" } : {});
    await nativeBrowser(context);
    const page = await context.newPage();
    try {
      // Connect in browser first; desktop's existing setup handoff remains unchanged.
      await loginEmail(page, app);
      const connect = await context.request.post(`${app.origin}/api/integrations/google-sheets/connect`, {
        headers: { Origin: app.origin },
        data: {},
      });
      const authorization = new URL((await connect.json()).url);
      expect(
        (
          await context.request.get(
            `${app.origin}/api/integrations/google-sheets/callback?code=fixture-code&state=${encodeURIComponent(authorization.searchParams.get("state")!)}`,
          )
        ).ok(),
      ).toBe(true);
      const providerCount = (await app.runtime.googleRequests()).length;
      const oauth: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("google-sheets/connect")) oauth.push(request.url());
      });
      await page.getByRole("button", { name: "Commands", exact: false }).click();
      const dialog = page.getByRole("dialog", { name: "Commands", exact: true });
      await expect(dialog.getByRole("button", { name: "Sync to Google Sheets", exact: true })).toBeEnabled();
      expect((await app.runtime.googleRequests()).length).toBe(providerCount);
      await dialog.getByRole("button", { name: "Sync to Google Sheets", exact: true }).click();
      await expect(dialog.getByRole("status")).toHaveText("Google Sheets synced successfully.");
      expect((await app.runtime.googleRequests()).length).toBeGreaterThan(providerCount);
      await page.route("**/api/integrations/google-sheets/sync", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ configured: true, connected: true, error: "secret-provider-token" }),
        });
      });
      await dialog.getByRole("button", { name: "Sync to Google Sheets", exact: true }).click();
      await expect(dialog.getByRole("button", { name: "Syncing to Google Sheets…", exact: true })).toBeDisabled();
      await expect(dialog.getByRole("alert")).toContainText("could not be synced");
      await expect(dialog).not.toContainText("secret-provider-token");
      await expect(dialog.getByRole("status")).toHaveCount(0);
      await page.unroute("**/api/integrations/google-sheets/sync");
      await page.route("**/api/integrations/google-sheets/sync", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ configured: true, connected: false, error: null, lastSyncedAt: null }),
        }),
      );
      await dialog.getByRole("button", { name: "Sync to Google Sheets", exact: true }).click();
      await expect(dialog).toContainText("Connect Google Sheets in Settings before syncing");
      await expect(dialog.getByRole("button", { name: "Sync to Google Sheets", exact: true })).toBeDisabled();
      await expect(dialog.getByRole("status")).toHaveCount(0);
      expect(oauth).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test("command shortcut preserves editor and modal shortcuts, focus and disconnected guidance", async ({
  browser,
  emailApp: app,
}) => {
  const context = await browser.newContext();
  await nativeBrowser(context);
  const page = await context.newPage();
  try {
    await loginEmail(page, app);
    const trigger = page.getByRole("button", { name: "Commands", exact: false });
    await trigger.focus();
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Commands", exact: true });
    await expect(dialog).toContainText("Connect Google Sheets in Settings before syncing");
    await expect(dialog.getByRole("button", { name: "Sync to Google Sheets", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await trigger.focus();
    await page.keyboard.press("Meta+k");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    const search = page.getByRole("searchbox", { name: "Search issues", exact: true });
    await search.focus();
    await search.press("Control+k");
    await expect(dialog).toHaveCount(0);
    await expect(search).toBeFocused();
    await page.getByRole("button", { name: "New issue" }).click();
    const title = page.getByRole("textbox", { name: "Issue title", exact: true });
    await title.fill("Editor command");
    await title.press("Control+k");
    await expect(dialog).toHaveCount(0);
    await expect(title).toBeFocused();
    await page.keyboard.press("Escape");
    // A component that handles its own shortcut keeps it; window's bubble handler sees defaultPrevented.
    await trigger.evaluate((element) =>
      element.addEventListener("keydown", (event) => {
        if (event instanceof KeyboardEvent && event.key.toLowerCase() === "k") event.preventDefault();
      }),
    );
    await trigger.focus();
    await page.keyboard.press("Control+k");
    await expect(dialog).toHaveCount(0);
    expect(await app.runtime.googleRequests()).toEqual([]);
  } finally {
    await context.close();
  }
});

test("members cannot open owner commands or request Google status", async ({ browser, emailApp: app }) => {
  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  await nativeBrowser(ownerContext);
  await nativeBrowser(memberContext);
  const owner = await ownerContext.newPage();
  const member = await memberContext.newPage();
  try {
    await loginEmail(owner, app);
    const invitation = await ownerContext.request.post(`${app.origin}/api/invitations`, {
      headers: { Origin: app.origin },
      data: { email: "commands-member@datafog.ai" },
    });
    const { token } = await invitation.json();
    const email = "commands-member@datafog.ai";
    const agent = nativeAgent(app.runtime);
    await agent.requestLink(email);
    await agent.consume(linkToken(emailLink((await app.runtime.capturedEmails()).at(-1)!)));
    expect((await agent.json("/api/invitations/accept", { token })).status).toBe(200);
    await loginEmail(member, app, email);
    const requests: string[] = [];
    member.on("request", (request) => {
      if (request.url().includes("/api/integrations/google-sheets")) requests.push(request.url());
    });
    await member.reload();
    await expect(member.locator(".sync-indicator")).toContainText("Saved");
    await expect(member.getByRole("button", { name: "Commands", exact: false })).toHaveCount(0);
    await member.keyboard.press("Control+k");
    await expect(member.getByRole("dialog", { name: "Commands", exact: true })).toHaveCount(0);
    expect(requests).toEqual([]);
  } finally {
    await ownerContext.close();
    await memberContext.close();
  }
});
