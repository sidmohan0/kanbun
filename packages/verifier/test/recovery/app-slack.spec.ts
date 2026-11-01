import { test, expect, loginEmail, nativeBrowser } from "./app-email.fixture";

test("hands desktop Slack setup to browser settings before creating an OAuth grant", async ({
  browser,
  emailApp: app,
}) => {
  const context = await browser.newContext({ userAgent: "KanbunDesktop/1.0" });
  await nativeBrowser(context);
  const page = await context.newPage();
  const integrationRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/integrations/slack"))
      integrationRequests.push(request.method());
  });
  try {
    await loginEmail(page, app, app.runtime.ownerEmail, "#settings/integrations");
    const settings = page.getByRole("region", { name: "Slack connection", exact: true });
    await expect(settings.getByRole("link", { name: "Manage Slack in browser", exact: true })).toHaveAttribute(
      "href",
      `${app.origin}/?kanbun-browser=integrations#settings/integrations`,
    );
    await expect(settings.getByRole("button", { name: "Connect Slack", exact: true })).toHaveCount(0);
    expect(integrationRequests).toEqual([]);
  } finally {
    await context.close();
  }
});
