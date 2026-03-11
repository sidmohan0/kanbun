import { expect, test } from "@playwright/test";

test("operator can create a sequence from the sequence editor", async ({
  page,
}) => {
  const stamp = Date.now();
  const sequenceName = `Sequence ${stamp}`;

  await page.goto("/sequences");

  const createForm = page
    .locator("section")
    .filter({ hasText: "Create the first step" })
    .locator("form")
    .first();

  await createForm.getByRole("textbox", { name: "Sequence name" }).fill(sequenceName);
  await createForm.getByRole("spinbutton", { name: "Delay days" }).fill("1");
  await createForm
    .getByRole("textbox", { name: "Subject template" })
    .fill(`Checking in ${stamp}`);
  await createForm
    .getByRole("textbox", { name: "Body template" })
    .fill("Hi {{first_name}},\n\nWanted to follow up.\n");
  await createForm.getByRole("button", { name: "Create sequence" }).click();

  await expect(page).toHaveURL(/created=1/);
  await expect(page.getByText("Sequence created and ready for enrollment.")).toBeVisible();
  await expect(page.getByText(sequenceName, { exact: true })).toBeVisible();
});
