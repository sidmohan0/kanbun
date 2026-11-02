import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { nativeAgent, emailLink, linkToken } from "@kanbun/worker/testing";
import { test, expect, loginEmail, nativeBrowser } from "./app-email.fixture";

for (const desktop of [false, true]) {
  test(`ordinary member downloads and sets up analytics without owner or Google access (${desktop ? "desktop" : "browser"})`, async ({
    browser,
    emailApp: app,
  }) => {
    const owner = nativeAgent(app.runtime);
    await owner.requestLink(app.runtime.ownerEmail);
    await owner.consume(linkToken(emailLink((await app.runtime.capturedEmails()).at(-1)!)));
    const email = "analytics-member@datafog.ai";
    const invitation = (await (await owner.json("/api/invitations", { email })).json()) as { token: string };
    const member = nativeAgent(app.runtime);
    await member.requestLink(email);
    await member.consume(linkToken(emailLink((await app.runtime.capturedEmails()).at(-1)!)));
    expect((await member.json("/api/invitations/accept", { token: invitation.token })).status).toBe(200);
    const context = await browser.newContext(desktop ? { userAgent: "KanbunDesktop/1.0" } : {});
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await nativeBrowser(context);
    const page = await context.newPage();
    const ownerRequests: string[] = [];
    const googleRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      const path = url.pathname;
      if (
        ["sheets.googleapis.com", "www.googleapis.com", "accounts.google.com", "docs.google.com"].includes(url.hostname)
      )
        googleRequests.push(request.url());
      if (path.startsWith("/api/integrations/") || path === "/api/exports.csv") ownerRequests.push(path);
    });
    try {
      await loginEmail(page, app, email);
      expect((await (await context.request.get(`${app.origin}/api/context`)).json()).role).toBe("member");
      await page.getByRole("link", { name: "Analytics starter", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Analytics starter", exact: true, level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: "New issue" })).toHaveCount(0);
      const starter = page.getByRole("region", { name: "Analytics starter", exact: true });
      const pending = page.waitForEvent("download");
      await starter.getByRole("link", { name: "Download analytics workbook (.xlsx)", exact: true }).click();
      const download = await pending;
      expect(download.suggestedFilename()).toBe("kanbun-analytics-starter.xlsx");
      const bytes = await readFile((await download.path())!);
      const proof = JSON.parse(
        await readFile(new URL("../../../../apps/web/public/analytics/starter-proof.json", import.meta.url), "utf8"),
      );
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(proof.sha256);
      await starter.getByText("Set up Google Sheets or CSV imports", { exact: true }).click();
      await expect(starter).toContainText("Allow access");
      await expect(starter).toContainText("does not run in Excel or in Kanbun");
      const source = starter.getByRole("textbox", { name: "Synced spreadsheet URL", exact: true });
      await source.fill("https://example.invalid/spreadsheets/d/private");
      await expect(starter.getByRole("status")).toContainText("Enter a Google Sheets");
      await expect(starter.getByRole("button", { name: "Copy issues formula", exact: true })).toHaveCount(0);
      await source.fill("https://docs.google.com/spreadsheets/d/owned-source/edit?usp=sharing#gid=0");
      const formula = '=IMPORTRANGE("https://docs.google.com/spreadsheets/d/owned-source","Issues!A1:AA")';
      await expect(starter.getByRole("textbox", { name: "Issues import formula", exact: true })).toHaveValue(formula);
      await starter.getByRole("button", { name: "Copy issues formula", exact: true }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(formula);
      await expect(starter).toContainText("Members can ask their owner");
      expect(ownerRequests).toEqual([]);
      expect(googleRequests).toEqual([]);
      await page.getByRole("link", { name: /All issues/ }).click();
      await expect(starter).toHaveCount(0);
      await expect(page.getByRole("button", { name: "New issue" })).toBeVisible();
    } finally {
      await context.close();
    }
  });
}
