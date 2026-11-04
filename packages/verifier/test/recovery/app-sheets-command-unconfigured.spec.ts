import { test, expect, loginEmail, nativeBrowser } from "./app-email.fixture";

test("unconfigured command gives settings guidance without starting OAuth", async ({ browser, emailApp: app }) => {
  const context = await browser.newContext({ userAgent: "KanbunDesktop/1.0" });
  await nativeBrowser(context);
  const page = await context.newPage();
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/integrations/google-sheets/")) requests.push(request.url());
  });
  try {
    await loginEmail(page, app);
    await page.getByRole("button", { name: "Commands", exact: false }).click();
    const dialog = page.getByRole("dialog", { name: "Commands", exact: true });
    await expect(dialog).toContainText("not configured for this installation");
    await expect(dialog.getByRole("button", { name: "Sync to Google Sheets", exact: true })).toBeDisabled();
    await dialog.getByRole("link", { name: "Google Sheets settings", exact: true }).click();
    // The destination must remain usable once the dialog is dismissed.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("link", { name: "Manage Google Sheets in browser", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Google Sheets connection", exact: true })).toContainText(
      "Provider app credentials belong to the Kanbun service",
    );
    expect(requests).toEqual([]);
  } finally {
    await context.close();
  }
});
