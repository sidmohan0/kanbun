import { readFile } from "node:fs/promises";
import { test, expect, loginEmail, nativeBrowser } from "./app-email.fixture";

for (const desktop of [false, true]) {
  test(`downloads CSV without Google setup in ${desktop ? "desktop" : "browser"} settings and reports export errors`, async ({
    browser,
    emailApp: app,
  }) => {
    const context = await browser.newContext(desktop ? { userAgent: "KanbunDesktop/1.0" } : {});
    await nativeBrowser(context);
    const page = await context.newPage();
    const oauth: string[] = [];
    page.on("request", (request) => {
      if (/\/api\/integrations\/google-sheets\/(connect|sync)/.test(request.url())) oauth.push(request.url());
    });
    try {
      await loginEmail(page, app);
      await page.getByRole("button", { name: "New issue" }).click();
      await page
        .getByRole("textbox", { name: "Issue title", exact: true })
        .fill('=HYPERLINK("https://example.invalid","report")');
      await page.getByRole("button", { name: "Create issue", exact: true }).click();
      await expect(page.locator(".sync-indicator")).toContainText("Saved");
      await page.goto(`${app.origin}/#settings/integrations`);
      const exports = page.getByRole("region", { name: "CSV exports", exact: true });
      const pending = page.waitForEvent("download");
      await exports.getByRole("button", { name: "Download issues CSV", exact: true }).click();
      const download = await pending;
      expect(download.suggestedFilename()).toBe("kanbun-issues.csv");
      const text = await readFile((await download.path())!, "utf8");
      expect(text).toContain('"\t=HYPERLINK(""https://example.invalid"",""report"")"');
      const projectDownload = page.waitForEvent("download");
      await exports.getByRole("button", { name: "Download projects CSV", exact: true }).click();
      expect((await projectDownload).suggestedFilename()).toBe("kanbun-projects.csv");
      await page.route("**/api/exports.csv?type=issues", (route) =>
        route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Unavailable"}' }),
      );
      await exports.getByRole("button", { name: "Download issues CSV", exact: true }).click();
      await expect(exports.getByRole("alert")).toContainText("CSV could not be exported");
      await expect(exports.getByRole("button", { name: "Download issues CSV", exact: true })).toBeEnabled();
      expect(oauth).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
