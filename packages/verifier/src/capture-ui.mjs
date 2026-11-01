import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

// Capture only the local development workspace. No production data is changed.
const base = process.env.KANBUN_CAPTURE_URL ?? "http://127.0.0.1:5173";
const url = new URL(base);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
  throw new Error("UI capture only supports a local development URL.");
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const output = resolve(root, process.env.KANBUN_CAPTURE_DIR ?? "output/ui-capture");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1920, height: 1320 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});
const captured = [];
async function capture(name) {
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: false, animations: "disabled" });
  captured.push(name);
}
try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  const initialize = page.getByRole("button", { name: "Initialize local workspace" });
  const nav = page.getByRole("link", { name: /All issues/ });
  await Promise.race([nav.waitFor({ state: "visible" }), initialize.waitFor({ state: "visible" })]);
  if (await initialize.isVisible()) {
    await initialize.click();
    await nav.waitFor({ state: "visible" });
  }
  await page.getByRole("button", { name: /New issue/ }).waitFor({ state: "visible" });
  await capture("01-issues");
  await page.getByRole("button", { name: /New issue/ }).click();
  await capture("02-new-issue");
  await page.getByRole("button", { name: "Close new issue" }).click();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(page.getByRole("button", { name: "Board", exact: true })).toHaveAttribute("aria-pressed", "true");
  await capture("03-board");
  await page.getByRole("button", { name: "List", exact: true }).click();
  const editor = page.getByRole("button", { name: /^Edit title for / }).first();
  if (await editor.count()) {
    await editor.click();
    await capture("11-edit-title");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  await page.getByRole("searchbox", { name: "Search issues" }).fill("No matching issue example");
  await capture("12-search-empty");
  await page.getByRole("button", { name: "Clear filters" }).click();
  const issue = page.getByRole("link", { name: /^Open [A-Z]+-\d+$/ }).first();
  if (await issue.count()) {
    await issue.click();
    await page.getByRole("region", { name: "Issue details" }).waitFor();
    await page.getByRole("textbox", { name: "Description", exact: true }).waitFor({ state: "visible" });
    await expect(page.getByRole("textbox", { name: "Description", exact: true })).toBeEnabled();
    await expect(page.getByRole("status", { name: "Description status" })).toHaveText("Saved");
    await capture("04-issue-detail");
    await page.getByText("Structure and dependencies", { exact: true }).first().click();
    await capture("13-issue-relationships");
    await page.getByText("Structure and dependencies", { exact: true }).first().click();
    await page.getByRole("button", { name: "Create label" }).click();
    await capture("05-create-label");
  }
  await page.getByRole("link", { name: /My Issues/ }).click();
  await page.getByRole("heading", { name: "My Issues", exact: true }).waitFor();
  await capture("06-my-issues");
  await page.getByRole("link", { name: "Inbox" }).click();
  await page.getByRole("region", { name: "Notifications", exact: true }).waitFor();
  await capture("07-inbox");
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("region", { name: "Team and workflow settings", exact: true }).waitFor();
  await capture("08-team-settings");
  await page.getByRole("button", { name: "Workflow", exact: true }).click();
  await capture("14-workflow-settings");
  await page.goto(new URL("/#invite/example", base).href);
  await page.getByRole("heading", { name: "Your invitation" }).waitFor();
  await page.getByRole("button", { name: "Check invitation again" }).waitFor();
  await capture("09-invalid-invitation");
  await page.goto(new URL("/#signin/invalid", base).href);
  await page.getByRole("heading", { name: "Confirm your sign-in" }).waitFor();
  await capture("10-invalid-sign-in");
  await writeFile(
    resolve(output, "README.txt"),
    `Captured at 1920 × 1320 from ${url.origin}.\n${captured.join("\n")}\n\nHosted-only screens require an authenticated hosted session and are not captured by this local-only command. Issue detail and label screens require an existing local issue.\n`,
  );
  console.log(`Saved ${captured.length} screenshots to ${output}`);
} finally {
  await browser.close();
}
