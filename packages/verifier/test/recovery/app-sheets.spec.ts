import { test, expect, loginEmail, nativeBrowser } from "./app-sheets.fixture";

test("directs desktop Google setup to browser settings before starting authorization", async ({
  browser,
  emailApp: app,
}) => {
  const context = await browser.newContext({ userAgent: "KanbunDesktop/1.0" });
  await nativeBrowser(context);
  const page = await context.newPage();
  const requests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/integrations/google-sheets")) requests.push(request.url());
  });
  try {
    await loginEmail(page, app, app.runtime.ownerEmail, "#settings/integrations");
    const settings = page.getByRole("region", { name: "Google Sheets connection", exact: true });
    await expect(settings.getByRole("link", { name: "Manage Google Sheets in browser", exact: true })).toHaveAttribute(
      "href",
      `${app.origin}/?kanbun-browser=integrations#settings/integrations`,
    );
    await expect(settings.getByRole("button", { name: "Connect Google Sheets", exact: true })).toHaveCount(0);
    expect(requests).toEqual([]);
    expect(await app.runtime.googleRequests()).toEqual([]);
  } finally {
    await context.close();
  }
});

test("connects Google Sheets, refreshes exports and disconnects through owner settings", async ({
  browser,
  emailApp: app,
}) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  await nativeBrowser(context);
  const page = await context.newPage();
  try {
    await context.route("https://accounts.google.com/o/oauth2/v2/auth?**", (route) => {
      const state = new URL(route.request().url()).searchParams.get("state")!;
      return route.fulfill({
        status: 302,
        headers: {
          location: `${app.origin}/api/integrations/google-sheets/callback?code=fixture-code&state=${encodeURIComponent(state)}`,
        },
      });
    });
    await loginEmail(page, app, app.runtime.ownerEmail, "#settings/integrations");
    const settings = page.getByRole("region", { name: "Google Sheets connection", exact: true });
    await settings.getByRole("button", { name: "Connect Google Sheets", exact: true }).click();
    await expect(settings.getByRole("link", { name: "Open synced spreadsheet", exact: true })).toHaveAttribute(
      "href",
      "https://docs.google.com/spreadsheets/d/fixture-spreadsheet/edit",
    );
    await expect(settings).toContainText("Last updated");
    await settings.getByRole("checkbox", { name: "Include projects", exact: true }).check();
    await expect(settings.getByRole("checkbox", { name: "Include projects", exact: true })).toBeChecked();
    const count = (await app.runtime.googleRequests()).length;
    await settings.getByRole("button", { name: "Update now", exact: true }).click();
    await expect.poll(async () => (await app.runtime.googleRequests()).length).toBeGreaterThan(count);
    await expect(settings.getByRole("button", { name: "Disconnect Google Sheets", exact: true })).toBeEnabled();
    await settings.getByRole("button", { name: "Disconnect Google Sheets", exact: true }).click();
    await expect(settings.getByRole("button", { name: "Connect Google Sheets", exact: true })).toBeVisible();
    await expect(settings.getByRole("link", { name: "Open synced spreadsheet", exact: true })).toHaveCount(0);
    expect(await app.runtime.googleStoredConnection()).toBeNull();
  } finally {
    await context.close();
  }
});
