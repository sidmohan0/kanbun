import { expect, test } from "@playwright/test";

test("review inbox loads its major sections", async ({ page }) => {
  await page.goto("/reviews");

  await expect(
    page.getByRole("heading", { name: "Everything waiting on judgment" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Pending approvals and retries" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Provider conflicts" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Reconnects and degraded sync" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Worker results that need cleanup" }),
  ).toBeVisible();
});
