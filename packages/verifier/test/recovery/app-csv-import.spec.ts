import { test, expect, loginEmail, nativeBrowser } from "./app-email.fixture";

test("maps, previews and imports CSV issues while skipping repeated source IDs", async ({ browser, emailApp: app }) => {
  const context = await browser.newContext();
  await nativeBrowser(context);
  const page = await context.newPage();
  try {
    await loginEmail(page, app);
    await page.goto(`${app.origin}/#settings/integrations`);
    const importer = page.getByRole("region", { name: "Import issues from CSV", exact: true });
    await importer.locator('input[type="file"]').setInputFiles({
      name: "issues.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        [
          "ID,Team,Title,Description,Status,Estimate,Priority,Due Date",
          'EXT-1,DataFog,Imported CSV issue,"Description, with comma",,3,High,2026-04-02',
          ["EXT-1", "DataFog", "Repeated CSV issue", "", "", "", "", ""].join(","),
        ].join("\r\n"),
      ),
    });
    await expect(importer.getByRole("status")).toContainText("1 ready · 1 duplicate IDs skipped");
    await expect(importer).toContainText("Ignored columns: Team");
    await expect(importer).toContainText("Description, with comma");
    await importer.getByRole("button", { name: "Import 1 ready issue", exact: true }).click();
    await expect(importer.getByText("1 issue imported successfully.", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    const csv = await page.evaluate(async () => await (await fetch("/api/exports.csv?type=issues")).text());
    expect(csv).toContain('"Imported CSV issue"');
    expect(csv).toContain('"Description, with comma"');
    expect(csv).not.toContain("EXT-1");
    expect(csv).not.toContain("Repeated CSV issue");
  } finally {
    await context.close();
  }
});
