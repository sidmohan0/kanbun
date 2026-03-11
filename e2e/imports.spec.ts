import { expect, test } from "@playwright/test";

test("operator can preview and queue a CSV import", async ({ page }) => {
  const stamp = Date.now();
  const csv = [
    "name,email,company,title",
    `Import Contact ${stamp},import.${stamp}@example.com,Kanbun Labs,Founder`,
  ].join("\n");

  await page.goto("/imports");

  await page.getByLabel("Import label").fill(`Import ${stamp}`);
  await page.locator('input[type="file"]').setInputFiles({
    mimeType: "text/csv",
    name: `contacts-${stamp}.csv`,
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "Upload for preview" }).click();

  await expect(page).toHaveURL(/\/imports\?import=/);
  await expect(page.getByText("Draft preview ready")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: `Import ${stamp}` }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm and queue" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Confirm and queue" }).click();
  await expect(page).toHaveURL(/queued=1/);
  await expect(
    page.getByRole("button", { name: "Queued for worker" }),
  ).toBeVisible();
});
