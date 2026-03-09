import { expect, test } from "@playwright/test";

test("operator can create, search, edit, and follow up a contact", async ({
  page,
}) => {
  const stamp = Date.now();
  const name = `E2E Contact ${stamp}`;
  const email = `e2e.${stamp}@example.com`;

  await page.goto("/contacts");

  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Primary email").fill(email);
  await page.getByLabel("Company").fill("Kanbun Labs");
  await page.getByLabel("Title").fill("Operator");
  await page
    .getByLabel("Relationship summary")
    .fill("Created during browser coverage.");
  await page.getByRole("button", { name: "Create contact" }).click();

  await expect(page).toHaveURL(/\/contacts\/.+\?created=1$/);
  await expect(page.getByRole("heading", { name })).toBeVisible();

  await page.getByLabel("Title").fill("Founder");
  await page
    .getByLabel("Relationship summary")
    .fill("Updated during browser coverage.");
  await page.getByRole("button", { name: "Save contact details" }).click();

  await expect(page).toHaveURL(/updated=1$/);
  await expect(page.getByText("Contact details updated.")).toBeVisible();

  await page.getByRole("button", { name: "Create follow-up" }).first().click();
  await expect(page.getByText(/Follow-up created/)).toBeVisible();

  await page.goto("/tasks");
  await expect(page.getByText(`Follow up with ${name}`)).toBeVisible();

  await page.goto("/contacts");
  await page
    .getByPlaceholder("Name, email, company, title, notes")
    .fill(name);
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText(name)).toBeVisible();
});
