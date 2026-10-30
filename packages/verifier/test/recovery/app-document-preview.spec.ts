import { issueIncarnation, type WorkspaceContext } from "@kanbun/sync";
import { test, expect } from "./app-preview.fixture";
import { readDescriptionRecord } from "./document-storage";

test("an expired hosted session hides the description while retaining its private offline draft for reauthentication", async ({
  browser,
  preview,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const contextResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/context");
    await page.goto(preview.origin);
    const identity = (await (await contextResponse).json()) as WorkspaceContext;
    await expect(page.getByRole("status")).toContainText("Saved");
    await page.getByRole("textbox", { name: "Issue title", exact: true }).fill("An authenticated description");
    await page.getByRole("button", { name: "Create issue", exact: true }).click();
    await expect(page.getByRole("row", { name: "KAN-1", exact: true })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Saved");
    const authority = await preview.runtime.inspect();
    const issue = authority.rows.issue?.find((issue) => issue["title"] === "An authenticated description");
    expect(issue).toBeDefined();
    const issueId = String(issue!["id"]);
    const incarnation = issueIncarnation({
      createdSeq: Number(issue!["createdSeq"]),
      createdAt: String(issue!["createdAt"]),
    });
    await page.getByRole("row", { name: "KAN-1", exact: true }).getByRole("link").click();
    const description = page.getByRole("textbox", { name: "Description", exact: true });
    const status = page.getByRole("status", { name: "Description status", exact: true });
    await expect(status).toContainText("Saved");
    await description.fill("Description visible to the verified owner.");
    await expect(status).toContainText("Saved");
    await page.route("**/sync/document", (route) => route.abort("internetdisconnected"));
    await description.fill("Private description draft survives expired authentication.");
    await expect(status).toContainText(/waiting for connection/i);
    const key = JSON.stringify([
      "v2",
      identity.mode,
      identity.workspaceId,
      identity.actor.type,
      identity.actor.id,
      "main",
      issueId,
      incarnation,
    ]);
    await expect.poll(async () => (await readDescriptionRecord(page, key))?.pending).toBe(true);
    const pending = await readDescriptionRecord(page, key);
    preview.setToken(await preview.runtime.token({ exp: 1 }));
    await page.unroute("**/sync/document");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Sign in again");
    await expect(description).toHaveCount(0);
    await expect(
      page.getByText("Private description draft survives expired authentication.", { exact: true }),
    ).toHaveCount(0);
    expect(await readDescriptionRecord(page, key)).toEqual(pending);
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("Sign in again");
    await expect(description).toHaveCount(0);
    expect(await readDescriptionRecord(page, key)).toEqual(pending);
    preview.setToken(preview.ownerToken);
    await page.reload();
    await expect(description).toHaveValue("Private description draft survives expired authentication.");
    await expect(status).toContainText("Saved");
    await expect.poll(async () => (await readDescriptionRecord(page, key))?.pending).toBe(false);
    const recovered = await preview.runtime.inspect();
    expect(recovered.rows.issue?.find((issue) => issue["id"] === issueId)?.["description"]).toBe(
      "Private description draft survives expired authentication.",
    );
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
