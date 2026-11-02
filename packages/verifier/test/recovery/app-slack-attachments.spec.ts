import { test, expect } from "./app.fixture";

test("adds literal Slack links without syncing, survives reload and removes them across browsers", async ({
  browser,
  app,
}) => {
  const firstContext = await browser.newContext(),
    secondContext = await browser.newContext();
  const first = await firstContext.newPage(),
    second = await secondContext.newPage();
  const region = (page: typeof first) => page.getByRole("region", { name: "Slack message links", exact: true });
  const url = "https://example.slack.com/archives/C123ABC/p1234567890123456?thread_ts=1234567890.123456&cid=C123ABC";
  try {
    for (const page of [first, second]) {
      await page.goto(`${app.origin}/#issues/${app.issueId}`);
      await expect(page.locator(".sync-indicator")).toContainText("Saved");
      await expect(region(page).getByRole("button", { name: "Add Slack link", exact: true })).toBeEnabled();
    }
    await region(first).getByRole("textbox", { name: "Slack message URL", exact: true }).fill("javascript:alert(1)");
    await region(first).getByRole("button", { name: "Add Slack link", exact: true }).click();
    await expect(region(first).getByRole("alert")).toContainText("Enter a Slack message link");
    await region(first).getByRole("textbox", { name: "Slack message URL", exact: true }).fill(url);
    await region(first).getByRole("textbox", { name: "Link title", exact: true }).fill("<b>Launch discussion</b>");
    await region(first).getByRole("button", { name: "Add Slack link", exact: true }).click();
    const link = region(second).getByRole("link", { name: "<b>Launch discussion</b>", exact: true });
    await expect(link).toHaveAttribute("href", url.replace("&cid=C123ABC", ""));
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await first.reload();
    await expect(region(first).getByRole("link", { name: "<b>Launch discussion</b>", exact: true })).toBeVisible();
    await region(first).getByRole("button", { name: "Remove <b>Launch discussion</b>", exact: true }).click();
    await expect(link).toHaveCount(0);
    await second.reload();
    await expect(region(second).getByRole("link")).toHaveCount(0);
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});
