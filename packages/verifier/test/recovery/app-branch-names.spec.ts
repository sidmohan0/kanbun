import type { BootstrapResponse } from "@kanbun/sync";
import { test, expect, loginEmail, nativeBrowser, requestEmail, consumeEmail } from "./app-email.fixture";

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

test("ordinary members manage their own code preferences without loading owner settings", async ({
  browser,
  emailApp: app,
}) => {
  const ownerContext = await browser.newContext(),
    memberContext = await browser.newContext();
  await nativeBrowser(ownerContext);
  await nativeBrowser(memberContext);
  const owner = await ownerContext.newPage(),
    member = await memberContext.newPage();
  const memberEmail = "code-settings-member@datafog.ai";
  const administrativeRequests: string[] = [];
  member.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/integrations/") || path === "/api/members" || path === "/api/exports.csv")
      administrativeRequests.push(path);
  });
  try {
    await loginEmail(owner, app);
    await owner.getByRole("link", { name: "Settings", exact: true }).click();
    await owner.getByRole("link", { name: "Members", exact: true }).click();
    await owner.getByText("Invite member", { exact: true }).click();
    await owner.getByRole("textbox", { name: "Invite by email", exact: true }).fill(memberEmail);
    await owner.getByRole("button", { name: "Create invitation", exact: true }).click();
    const destination = new URL(await owner.getByRole("textbox", { name: "Invitation link", exact: true }).inputValue())
      .hash;
    const signIn = await requestEmail(member, app, memberEmail, destination);
    await consumeEmail(member, app, memberEmail, signIn);
    await member.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await expect(member.locator(".sync-indicator")).toContainText("Saved");
    await member.getByRole("link", { name: "Settings", exact: true }).click();
    const personal = member.getByRole("region", { name: "Personal settings", exact: true });
    const enabled = personal.getByRole("checkbox", {
      name: "Move issues to start when copying a git branch name",
      exact: true,
    });
    await expect(enabled).not.toBeChecked();
    await enabled.check();
    await personal
      .getByRole("checkbox", { name: "Assign unassigned issues to me when starting from a branch copy", exact: true })
      .check();
    await expect(member.locator(".sync-indicator")).toContainText("Saved");
    await member.reload();
    await expect(enabled).toBeChecked();
    for (const name of ["Workspace", "Integrations", "Teams", "Workflow"])
      await expect(member.getByRole("button", { name, exact: true })).toHaveCount(0);
    await expect(member.getByRole("link", { name: "Members", exact: true })).toHaveCount(0);
    await expect(member.getByRole("textbox", { name: "Git branch format", exact: true })).toHaveCount(0);
    await member.goto(`${app.origin}/#settings/integrations`);
    await expect(personal).toBeVisible();
    expect(administrativeRequests).toEqual([]);
    // Owner settings and preferences remain independently available.
    await owner.goto(`${app.origin}/#settings`);
    await owner.getByRole("button", { name: "Code & reviews", exact: true }).click();
    await expect(
      owner.getByRole("checkbox", { name: "Move issues to start when copying a git branch name", exact: true }),
    ).not.toBeChecked();
    // Exercise the preference as the admitted member, rather than only checking its UI.
    await member.goto(`${app.origin}/#issues`);
    await member.getByRole("button", { name: "New issue" }).click();
    await member.getByRole("textbox", { name: "Issue title", exact: true }).fill("Started by a member branch copy");
    await member.getByRole("button", { name: "Create issue", exact: true }).click();
    await expect(member.locator(".sync-indicator")).toContainText("Saved");
    const bootstrap = (await (
      await member.request.get(`${app.origin}/sync/bootstrap?clientId=member-code-reader`)
    ).json()) as BootstrapResponse;
    const issue = bootstrap.rows.issue!.find((row) => row.title === "Started by a member branch copy")!;
    const person = bootstrap.rows.user!.find((row) => row.email === memberEmail)!;
    await member.goto(`${app.origin}/#issues/${issue.id}`);
    await member.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.resolve() },
      }),
    );
    await member.getByRole("button", { name: "Copy git branch name", exact: true }).click();
    await expect
      .poll(async () => {
        const latest = (await (
          await member.request.get(`${app.origin}/sync/bootstrap?clientId=member-code-check`)
        ).json()) as BootstrapResponse;
        const current = latest.rows.issue!.find((row) => row.id === issue.id)!;
        return {
          type: latest.rows.workflowState!.find((state) => state.id === current.stateId)?.type,
          assigneeId: current.assigneeId,
        };
      })
      .toEqual({ type: "started", assigneeId: person.id });
    // Direct requests still meet the server's existing owner/admin boundaries.
    for (const path of [
      "/api/members",
      "/api/integrations/github",
      "/api/integrations/slack",
      "/api/integrations/google-sheets",
      "/api/exports.csv?type=issues",
    ]) {
      const denied = await member.request.get(`${app.origin}${path}`);
      expect(denied.status(), path).toBe(403);
    }
    const rejected = await member.request.post(`${app.origin}/sync/push`, {
      headers: { Origin: app.origin },
      data: {
        clientId: "member-branch-format-negative",
        mutations: [
          {
            id: 1,
            name: "organizationGitBranchFormatUpdate",
            args: { format: "member/{issueIdentifier}" },
            ts: new Date().toISOString(),
          },
        ],
      },
    });
    expect(await rejected.json()).toMatchObject({ rejected: [{ error: "Workspace admin required" }] });
  } finally {
    await Promise.allSettled([ownerContext.close(), memberContext.close()]);
  }
});
