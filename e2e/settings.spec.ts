import { expect, test } from "@playwright/test";

test("settings renders the integration health surface", async ({ page }) => {
  await page.goto("/settings");

  await expect(
    page.getByRole("heading", { name: "Integration health" }),
  ).toBeVisible();
  await expect(page.getByText("Gmail", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Microsoft Outlook", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Todoist", { exact: true })).toBeVisible();
});
