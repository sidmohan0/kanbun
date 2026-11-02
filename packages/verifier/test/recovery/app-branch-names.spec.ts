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

test("branch-copy preferences sync and start work only after successful clipboard access", async ({
  browser,
  emailApp: app,
}) => {
  const context = await browser.newContext();
  const secondContext = await browser.newContext();
  await nativeBrowser(context);
  await nativeBrowser(secondContext);
  const page = await context.newPage();
  try {
    await loginEmail(page, app);
    await page.getByRole("button", { name: "New issue" }).click();
    await page.getByRole("textbox", { name: "Issue title", exact: true }).fill("Branch copy automation");
    await page.getByRole("button", { name: "Create issue", exact: true }).click();
    await expect(page.locator(".sync-indicator")).toContainText("Saved");
    const bootstrap = (await (
      await page.request.get(`${app.origin}/sync/bootstrap?clientId=copy-start-reader`)
    ).json()) as BootstrapResponse;
    const issue = bootstrap.rows.issue!.find((row) => row.title === "Branch copy automation")!;
    await page.goto(`${app.origin}/#settings`);
    await page.getByRole("button", { name: "Code & reviews", exact: true }).click();
    const settings = page.getByRole("region", { name: "Code and reviews settings", exact: true });
    const enabled = settings.getByRole("checkbox", {
      name: "Move issues to start when copying a git branch name",
      exact: true,
    });
    await expect(enabled).not.toBeChecked();
    await enabled.check();
    await settings
      .getByRole("checkbox", { name: "Assign unassigned issues to me when starting from a branch copy", exact: true })
      .check();
    await expect(page.locator(".sync-indicator")).toContainText("Saved");
    await page.reload();
    await expect(enabled).toBeChecked();
    const second = await secondContext.newPage();
    await loginEmail(second, app, app.runtime.ownerEmail, "#settings");
    await second.getByRole("button", { name: "Code & reviews", exact: true }).click();
    const secondEnabled = second.getByRole("checkbox", {
      name: "Move issues to start when copying a git branch name",
      exact: true,
    });
    await expect(secondEnabled).toBeChecked();
    await secondEnabled.uncheck();
    await expect(enabled).not.toBeChecked();
    await secondEnabled.check();
    await expect(enabled).toBeChecked();
    await page.goto(`${app.origin}/#issues/${issue.id}`);
    const development = page.getByRole("region", { name: "Development", exact: true });
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error("Denied")) },
      }),
    );
    await development.getByRole("button", { name: "Copy git branch name", exact: true }).click();
    await expect(development.getByRole("alert")).toContainText("Select and copy it below");
    const readIssue = async () => {
      const response = (await (
        await page.request.get(`${app.origin}/sync/bootstrap?clientId=copy-start-check`)
      ).json()) as BootstrapResponse;
      return { issue: response.rows.issue!.find((row) => row.id === issue.id)!, states: response.rows.workflowState! };
    };
    expect((await readIssue()).issue.stateId).toBe(issue.stateId);
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.resolve() },
      }),
    );
    await page.getByRole("heading", { name: "Branch copy automation", exact: true }).click();
    await page.keyboard.press("Control+Shift+Period");
    await expect
      .poll(async () => {
        const current = await readIssue();
        return current.states.find((state) => state.id === current.issue.stateId)?.type;
      })
      .toBe("started");
    const owner = bootstrap.rows.user!.find((row) => row.email === app.runtime.ownerEmail)!;
    await expect.poll(async () => (await readIssue()).issue.assigneeId).toBe(owner.id);
  } finally {
    await Promise.allSettled([context.close(), secondContext.close()]);
  }
});
