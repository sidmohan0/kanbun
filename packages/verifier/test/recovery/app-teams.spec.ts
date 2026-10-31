import { test, expect, syncApi, readWorkspaceState } from "./app.fixture";

test("owner team settings create usable teams and custom workflow states and preserve offline edits", async ({
  page,
  app,
}) => {
  await page.goto(`${app.origin}/#settings`);
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.locator(".sync-indicator")).toContainText("Saved");
  await page.getByRole("textbox", { name: "New team name", exact: true }).fill("Engineering");
  await page.getByRole("textbox", { name: "New team key", exact: true }).fill("ENG");
  await page.getByRole("button", { name: "Create team", exact: true }).click();
  await expect(page.getByRole("region", { name: "Settings for Engineering", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "New status name", exact: true }).fill("Review");
  await page.getByRole("button", { name: "Add status", exact: true }).click();
  await page.getByRole("textbox", { name: "Name for In Progress", exact: true }).fill("Doing");
  await page
    .getByRole("listitem")
    .filter({ has: page.getByRole("textbox", { name: "Name for In Progress", exact: true }) })
    .getByRole("button", { name: "Save status", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Move Review up", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Move Review up", exact: true }).click();
  await expect(page.getByRole("button", { name: "Move Review up", exact: true })).toBeDisabled();
  await page
    .getByRole("combobox", { name: "Default status for new issues", exact: true })
    .selectOption({ label: "Review" });
  await page.getByRole("button", { name: "Save team settings", exact: true }).click();
  await expect(page.locator(".sync-indicator")).toContainText("Saved");
  await page.route(syncApi, (route) => route.abort("internetdisconnected"));
  await page.getByRole("textbox", { name: "Team name", exact: true }).fill("Platform");
  await page.getByRole("button", { name: "Save team settings", exact: true }).click();
  await expect
    .poll(async () => (await readWorkspaceState(page, "local:user-alice:main"))?.pending.length)
    .toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Choose a team", exact: true })).toContainText("Platform (ENG)");
  await page.unroute(syncApi);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(".sync-indicator")).toContainText("Saved");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: /^All issues/ })
    .click();
  await page.getByRole("combobox", { name: "Team", exact: true }).selectOption({ label: "ENG" });
  await page.getByRole("textbox", { name: "Issue title", exact: true }).fill("Platform first issue");
  await page.getByRole("button", { name: "Create issue", exact: true }).click();
  await expect(page.getByRole("row", { name: "ENG-1", exact: true })).toContainText("Review");
  await app.runtime.restart();
  await page.reload();
  await expect(page.getByRole("row", { name: "ENG-1", exact: true })).toContainText("Platform first issue");
  const originalLink = await page.getByRole("link", { name: "Open ENG-1", exact: true }).getAttribute("href");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Choose a team", exact: true }).selectOption({ label: "Platform (ENG)" });
  await page.getByRole("textbox", { name: "Team key", exact: true }).fill("plat");
  await page.getByRole("button", { name: "Save team settings", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Choose a team", exact: true })).toContainText("Platform (PLAT)");
  await expect(page.locator(".sync-indicator")).toContainText("Saved");
  await app.runtime.restart();
  await page.reload();
  await expect(page.locator(".sync-indicator")).toContainText("Saved");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: /^All issues/ })
    .click();
  await expect(page.getByRole("row", { name: "PLAT-1", exact: true })).toContainText("Platform first issue");
  await expect(page.getByRole("link", { name: "Open PLAT-1", exact: true })).toHaveAttribute("href", originalLink!);
  await expect(page.getByRole("row", { name: "ENG-1", exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Team", exact: true }).selectOption({ label: "PLAT" });
  await page.getByRole("textbox", { name: "Issue title", exact: true }).fill("Platform next issue");
  await page.getByRole("button", { name: "Create issue", exact: true }).click();
  await expect(page.getByRole("row", { name: "PLAT-2", exact: true })).toContainText("Platform next issue");
});
