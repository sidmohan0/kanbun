import { type WorkspaceContext } from "@kanbun/sync";
import { SESSION_COOKIE } from "@kanbun/worker/testing";
import { test, expect, nativeBrowser, requestEmail, consumeEmail, loginEmail } from "./app-email.fixture";
import { readWorkspaceState } from "./app.fixture";

const persistedKey = (context: WorkspaceContext) => JSON.stringify([
  "v1", context.mode, context.workspaceId, context.actor.type, context.actor.id, "main", ...(context.admissionId ? [context.admissionId] : []),
]);

test("native sign-in needs the requesting browser and explicit confirmation, and logout hides workspace data", async ({ browser, emailApp }, testInfo) => {
  const ownerContext = await browser.newContext(), otherContext = await browser.newContext();
  await nativeBrowser(ownerContext); await nativeBrowser(otherContext);
  const owner = await ownerContext.newPage(), other = await otherContext.newPage();
  try {
    const link = await requestEmail(owner, emailApp, emailApp.runtime.ownerEmail);
    await other.goto(`${emailApp.origin}/${link.hash}`);
    await expect(other.getByRole("alert")).toContainText("different browser");
    await expect(other.getByRole("button", { name: `Sign in as ${emailApp.runtime.ownerEmail}`, exact: true })).toHaveCount(0);
    expect(await otherContext.cookies()).not.toContainEqual(expect.objectContaining({ name: SESSION_COOKIE }));
    await owner.goto(`${emailApp.origin}/${link.hash}`);
    await expect(owner.getByRole("button", { name: `Sign in as ${emailApp.runtime.ownerEmail}`, exact: true })).toBeVisible();
    expect((await ownerContext.cookies()).some((cookie) => cookie.name === SESSION_COOKIE)).toBe(false);
    expect(await owner.evaluate(async () => (await indexedDB.databases()).map((db) => db.name))).not.toContain("kanbun");
    await owner.getByRole("button", { name: `Sign in as ${emailApp.runtime.ownerEmail}`, exact: true }).click();
    await expect(owner.locator(".sync-indicator")).toContainText("Saved");
    expect(new URL(owner.url()).hash).toBe("#issues");
    const session = (await ownerContext.cookies()).find((cookie) => cookie.name === SESSION_COOKIE)!;
    expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
    expect(await owner.evaluate(() => document.cookie)).not.toContain(SESSION_COOKIE);
    await owner.getByRole("textbox", { name: "Issue title", exact: true }).fill("Native owner work");
    await owner.getByRole("button", { name: "Create issue", exact: true }).click();
    await expect(owner.getByRole("button", { name: /Edit title for KAN-1/ })).toContainText("Native owner work");
    await expect(owner.locator(".sync-indicator")).toContainText("Saved");
    await owner.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(owner.getByRole("heading", { name: "Sign in to kanbun", exact: true })).toBeVisible();
    await expect(owner.getByText("Native owner work", { exact: true })).toHaveCount(0);
    expect((await ownerContext.cookies()).some((cookie) => cookie.name === SESSION_COOKIE)).toBe(false);
    await testInfo.attach("native-email-sign-in", { body: await owner.screenshot({ fullPage: true }), contentType: "image/png" });
  } finally { await Promise.allSettled([ownerContext.close(), otherContext.close()]); }
});

test("an email-only invite preserves its destination through sign-in and opens the targeted workspace", async ({ browser, emailApp }) => {
  const ownerContext = await browser.newContext(), memberContext = await browser.newContext();
  await nativeBrowser(ownerContext); await nativeBrowser(memberContext);
  const owner = await ownerContext.newPage(), member = await memberContext.newPage();
  const memberEmail = "josh@datafog.ai";
  try {
    await loginEmail(owner, emailApp);
    await owner.getByRole("link", { name: "Members", exact: true }).click();
    await owner.getByRole("textbox", { name: "Invite by email", exact: true }).fill(memberEmail);
    await owner.getByRole("button", { name: "Create invitation", exact: true }).click();
    const invitationLink = owner.getByRole("textbox", { name: "Invitation link", exact: true });
    await expect(invitationLink).toBeVisible();
    const destination = new URL(await invitationLink.inputValue()).hash;
    const signIn = await requestEmail(member, emailApp, memberEmail, destination);
    expect(decodeURIComponent(signIn.hash.split("/").slice(2).join("/"))).toBe(destination);
    await consumeEmail(member, emailApp, memberEmail, signIn);
    await expect(member.getByRole("heading", { name: "Join Private preview", exact: true })).toBeVisible();
    expect(new URL(member.url()).hash).toBe(destination);
    expect(await member.evaluate(async () => (await indexedDB.databases()).map((db) => db.name))).not.toContain("kanbun");
    await member.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await expect(member.locator(".sync-indicator")).toContainText("Saved");
    expect(new URL(member.url()).hash).toBe("#issues");
    await expect(member.getByRole("link", { name: "Members", exact: true })).toHaveCount(0);
    const context = await memberContext.request.get(`${emailApp.origin}/api/context`);
    expect(context.status()).toBe(200);
    expect((await context.json()) as WorkspaceContext).toMatchObject({ email: memberEmail, role: "member", workspaceId: emailApp.runtime.workspaceId });
  } finally { await Promise.allSettled([ownerContext.close(), memberContext.close()]); }
});

test("native expiry hides cached work while the same person can sign in again and recover the saved offline queue", async ({ browser, emailApp }) => {
  const context = await browser.newContext(); await nativeBrowser(context);
  const page = await context.newPage();
  try {
    await loginEmail(page, emailApp);
    const identity = (await (await context.request.get(`${emailApp.origin}/api/context`)).json()) as WorkspaceContext;
    await page.getByRole("textbox", { name: "Issue title", exact: true }).fill("Offline native task");
    await page.getByRole("button", { name: "Create issue", exact: true }).click();
    await expect(page.getByRole("button", { name: /Edit title for KAN-1/ })).toContainText("Offline native task");
    await expect(page.locator(".sync-indicator")).toContainText("Saved");
    await page.route("**/sync/push", (route) => route.abort("internetdisconnected"));
    await page.getByRole("button", { name: /Edit title for KAN-1/ }).click();
    const editor = page.getByRole("textbox", { name: "Title for KAN-1", exact: true });
    await editor.fill("Recovered native task");
    await editor.press("Enter");
    const key = persistedKey(identity);
    await expect.poll(async () => (await readWorkspaceState(page, key))?.pending.length).toBe(1);
    const session = (await context.cookies()).find((cookie) => cookie.name === SESSION_COOKIE)!;
    await emailApp.runtime.expireNativeSession(session.value);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByRole("heading", { name: "Sign in to kanbun", exact: true })).toBeVisible();
    await expect(page.getByText("Recovered native task", { exact: true })).toHaveCount(0);
    expect((await readWorkspaceState(page, key))?.pending).toHaveLength(1);
    await page.unroute("**/sync/push");
    await loginEmail(page, emailApp);
    const renewed = (await (await context.request.get(`${emailApp.origin}/api/context`)).json()) as WorkspaceContext;
    expect(renewed.actor).toEqual(identity.actor);
    expect(renewed.workspaceId).toBe(identity.workspaceId);
    expect(renewed.admissionId).toBe(identity.admissionId);
    await expect(page.getByRole("button", { name: /Edit title for KAN-1/ })).toContainText("Recovered native task");
    await expect.poll(async () => (await readWorkspaceState(page, key))?.pending.length).toBe(0);
    await page.reload();
    await expect(page.getByRole("button", { name: /Edit title for KAN-1/ })).toContainText("Recovered native task");
  } finally { await context.close(); }
});
