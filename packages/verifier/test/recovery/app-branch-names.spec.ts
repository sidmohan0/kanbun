import type { BootstrapResponse } from "@kanbun/sync";
import { test, expect, loginEmail, nativeBrowser } from "./app-email.fixture";

test("legacy desktop integration settings expose a browser fallback before creating OAuth state", async ({
  browser,
  emailApp: app,
}) => {
  const context = await browser.newContext({ userAgent: "KanbunDesktop/1.0" });
  await nativeBrowser(context);
  const page = await context.newPage();
  const integrationRequests: string[] = [];
  context.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/integrations/github")) integrationRequests.push(request.url());
  });
  try {
    await loginEmail(page, app, app.runtime.ownerEmail, "#settings/integrations");
    const connection = page.getByRole("region", { name: "GitHub connection", exact: true });
    await expect(connection.getByRole("link", { name: "Manage GitHub in browser", exact: true })).toHaveAttribute(
      "href",
      `${app.origin}/?kanbun-browser=integrations#settings/integrations`,
    );
    await expect(connection.getByRole("button", { name: "Connect GitHub", exact: true })).toHaveCount(0);
    await expect(connection).toContainText("Sign in there");
    // Existing installed builds advertise this UA but cannot intercept the one-click marker.
    await expect(connection).toContainText("copy this address and paste it into your browser");
    await expect(connection.locator("code")).toHaveText(`${app.origin}/#settings/integrations`);
    expect(integrationRequests).toEqual([]);
  } finally {
    await context.close();
  }
});

test("shares the branch format across browsers and copies the current issue name without intercepting text editing", async ({
  browser,
  emailApp: app,
}) => {
  const settingsContext = await browser.newContext(),
    issueContext = await browser.newContext();
  await nativeBrowser(settingsContext);
  await nativeBrowser(issueContext);
  const copies: string[] = [];
  const settings = await settingsContext.newPage(),
    detail = await issueContext.newPage();
  // Substitute only the OS clipboard boundary; all settings, auth and sync use the product.
  await detail.exposeFunction("captureBranchName", (value: string) => {
    copies.push(value);
  });
  await detail.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) =>
          (window as unknown as { captureBranchName(text: string): Promise<void> }).captureBranchName(text),
      },
    });
  });
  try {
    await loginEmail(settings, app);
    await settings.getByRole("button", { name: "New issue" }).click();
    await settings.getByRole("textbox", { name: "Issue title", exact: true }).fill("Improve search ranking");
    await settings.getByRole("button", { name: "Create issue", exact: true }).click();
    await expect(settings.locator(".sync-indicator")).toContainText("Saved");
    const bootstrap = (await (
      await settings.request.get(`${app.origin}/sync/bootstrap?clientId=branch-reader`)
    ).json()) as BootstrapResponse;
    const issue = bootstrap.rows.issue!.find((row) => row.title === "Improve search ranking")!;
    const team = bootstrap.rows.team!.find((row) => row.id === issue.teamId)!;
    const identifier = `${team.key}-${issue.number}`.toLowerCase();
    await loginEmail(detail, app, app.runtime.ownerEmail, `#issues/${issue.id}`);
    const development = detail.getByRole("region", { name: "Development", exact: true });
    await settings.goto(`${app.origin}/#settings/integrations`);
    const format = settings.getByRole("region", { name: "Git branch names", exact: true });
    await format
      .getByRole("textbox", { name: "Git branch format", exact: true })
      .fill("fix/{issueIdentifier}-{issueTitle}");
    await format.getByRole("button", { name: "Save branch format", exact: true }).click();
    const expected = `fix/${identifier}-improve-search-ranking`;
    await expect(development.locator("code")).toHaveText(expected);
    await development.getByRole("button", { name: "Copy git branch name", exact: true }).click();
    await expect.poll(() => copies).toEqual([expected]);
    await expect(development.getByRole("status")).toHaveText("Branch name copied");
    await detail.getByRole("heading", { name: "Improve search ranking", exact: true }).click();
    await detail.keyboard.press("Control+Shift+Period");
    await expect.poll(() => copies).toEqual([expected, expected]);
    const description = detail.getByRole("textbox", { name: "Description", exact: true });
    await description.focus();
    await detail.keyboard.press("Control+Shift+Period");
    expect(copies).toEqual([expected, expected]);
    await format.getByRole("textbox", { name: "Git branch format", exact: true }).fill("{unknown}/invalid");
    await format.getByRole("button", { name: "Save branch format", exact: true }).click();
    await expect(format.getByRole("alert")).toContainText("Use {issueIdentifier}");
    await detail.reload();
    await expect(development.locator("code")).toHaveText(expected);
    // Clipboard denial is visible and leaves a selectable branch name as a fallback.
    await detail.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }),
    );
    await development.getByRole("button", { name: "Copy git branch name", exact: true }).click();
    await expect(development.getByRole("alert")).toContainText("Select and copy it below");
    await expect(development.locator("code")).toHaveText(expected);
  } finally {
    await Promise.allSettled([settingsContext.close(), issueContext.close()]);
  }
});
