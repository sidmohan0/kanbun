import { expect, test } from "@playwright/test";

test("operator can complete, reopen, and snooze tasks", async ({ page }) => {
  const stamp = Date.now();
  const name = `Task Contact ${stamp}`;
  const email = `tasks.${stamp}@example.com`;

  await page.goto("/contacts");

  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Primary email").fill(email);
  await page.getByRole("button", { name: "Create contact" }).click();
  await expect(page).toHaveURL(/\/contacts\/.+\?created=1$/);

  await page.getByRole("button", { name: "Create follow-up" }).first().click();
  await expect(page.getByText(/Follow-up created/)).toBeVisible();

  await page.goto("/tasks");
  await expect(page.getByText(`Follow up with ${name}`)).toBeVisible();

  const openSection = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Open follow-ups" }),
  });
  const taskTitle = `Follow up with ${name}`;
  const openCard = openSection.locator(`[data-task-title="${taskTitle}"]`).first();
  await openCard.getByRole("button", { name: "Complete" }).click();
  await expect(page.getByText(/Task completed/)).toBeVisible();
  const completedSection = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Completed tasks" }),
  });
  const completedCard = completedSection.locator(
    `[data-task-title="${taskTitle}"]`,
  );
  await expect(completedCard.getByText(taskTitle)).toBeVisible();

  await completedCard.getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByText(/Task reopened/)).toBeVisible();

  const reopenedCard = openSection.locator(`[data-task-title="${taskTitle}"]`).first();
  await reopenedCard.getByRole("button", { name: "Snooze 2 days" }).click();
  await expect(page.getByText(/Task snoozed/)).toBeVisible();
  const snoozedSection = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Snoozed tasks" }),
  });
  const snoozedCard = snoozedSection.locator(
    `[data-task-title="${taskTitle}"]`,
  );
  await expect(snoozedCard.getByText(taskTitle)).toBeVisible();
});
