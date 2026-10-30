import { test, expect, selectPrincipal } from "./app-membership.fixture";

test("workspace name changes reach another owner browser and members cannot open settings", async ({
  browser,
  membership: app,
}, testInfo) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const member = await browser.newContext();
  try {
    await selectPrincipal(first, app.origin, "owner");
    await selectPrincipal(second, app.origin, "owner");
    await selectPrincipal(member, app.origin, "member");
    const ownerPage = await first.newPage();
    const observerPage = await second.newPage();
    await ownerPage.goto(`${app.origin}/#settings`);
    await observerPage.goto(`${app.origin}/#issues`);
    await expect(ownerPage.locator(".sync-indicator")).toContainText("Saved");
    await expect(observerPage.locator(".sync-indicator")).toContainText("Saved");
    await ownerPage.getByRole("textbox", { name: "Workspace name", exact: true }).fill("DataFog pilot");
    await ownerPage.getByRole("button", { name: "Save workspace name", exact: true }).click();
    await expect(observerPage.locator(".workspace-label")).toContainText("DataFog pilot");
    await ownerPage.reload();
    await expect(ownerPage.getByRole("textbox", { name: "Workspace name", exact: true })).toHaveValue("DataFog pilot");
    await testInfo.attach("workspace-settings", {
      body: await ownerPage.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    const created = await app.runtime.fetch("/api/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: app.memberEmail }),
    });
    const grant = (await created.json()) as { token: string };
    expect(
      (
        await app.runtime.fetch(
          "/api/invitations/accept",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: grant.token }),
          },
          app.memberToken,
        )
      ).status,
    ).toBe(200);
    const memberPage = await member.newPage();
    await memberPage.goto(`${app.origin}/#settings`);
    await expect(
      memberPage.getByRole("heading", { name: "Workspace owner access required", exact: true }),
    ).toBeVisible();
    await expect(memberPage.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
    await expect(memberPage.getByRole("textbox", { name: "Workspace name", exact: true })).toHaveCount(0);
    await expect(memberPage.locator(".workspace-label")).toContainText("DataFog pilot");
    await ownerPage.route("**/api/workspace/name", (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Expired" }) }),
    );
    await ownerPage.getByRole("textbox", { name: "Workspace name", exact: true }).fill("Must not be saved");
    await ownerPage.getByRole("button", { name: "Save workspace name", exact: true }).click();
    await expect(ownerPage.getByRole("button", { name: "Sign in again", exact: true })).toBeVisible();
    await expect(ownerPage.getByRole("textbox", { name: "Workspace name", exact: true })).toHaveCount(0);
    expect(await app.runtime.directoryWorkspace()).toMatchObject({ name: "DataFog pilot" });
  } finally {
    await first.close();
    await second.close();
    await member.close();
  }
});
