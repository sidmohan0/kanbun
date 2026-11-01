import { type WorkspaceContext, type BootstrapResponse, type PushResponse } from "@kanbun/sync";
import { SESSION_COOKIE, nativeAgent, emailLink, linkToken } from "@kanbun/worker/testing";
import { test, expect, nativeBrowser, requestEmail, consumeEmail, loginEmail } from "./app-email.fixture";
import { readWorkspaceState } from "./app.fixture";

const persistedKey = (context: WorkspaceContext) =>
  JSON.stringify([
    "v1",
    context.mode,
    context.workspaceId,
    context.actor.type,
    context.actor.id,
    "main",
    ...(context.admissionId ? [context.admissionId] : []),
  ]);

test("user activity extends the idle window and an inactive session returns to sign-in", async ({
  browser,
  emailApp,
}) => {
  const context = await browser.newContext();
  await nativeBrowser(context);
  const page = await context.newPage();
  const day = 24 * 60 * 60 * 1000;
  try {
    await loginEmail(page, emailApp);
    const session = (await context.cookies()).find((cookie) => cookie.name === SESSION_COOKIE)!;
    const expires = new Date(Date.now() + 15 * day).toISOString();
    const oldActivity = new Date(Date.now() - 13 * day).toISOString();
    await emailApp.runtime.setNativeSessionTimes(session.value, oldActivity, expires);
    await page.getByRole("link", { name: /All issues/ }).click();
    await expect
      .poll(async () => String((await emailApp.runtime.authRows()).sessions[0]!.last_seen_at))
      .not.toBe(oldActivity);
    await emailApp.runtime.setNativeSessionTimes(
      session.value,
      new Date(Date.now() - 14 * day - 1000).toISOString(),
      expires,
    );
    await page.evaluate(() => {
      const realNow = Date.now.bind(Date);
      Date.now = () => realNow() + 61_000;
    });
    await page.keyboard.press("Tab");
    await expect(page.getByRole("heading", { name: "Sign in to kanbun", exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("native sign-in needs the requesting browser and explicit confirmation, and logout hides workspace data", async ({
  browser,
  emailApp,
}, testInfo) => {
  const ownerContext = await browser.newContext(),
    otherContext = await browser.newContext();
  await nativeBrowser(ownerContext);
  await nativeBrowser(otherContext);
  const owner = await ownerContext.newPage(),
    other = await otherContext.newPage();
  try {
    const link = await requestEmail(owner, emailApp, emailApp.runtime.ownerEmail);
    await other.goto(`${emailApp.origin}/${link.hash}`);
    await expect(other.getByRole("alert")).toContainText("different browser");
    await expect(
      other.getByRole("button", { name: `Sign in as ${emailApp.runtime.ownerEmail}`, exact: true }),
    ).toHaveCount(0);
    expect(await otherContext.cookies()).not.toContainEqual(expect.objectContaining({ name: SESSION_COOKIE }));
    await owner.goto(`${emailApp.origin}/${link.hash}`);
    await expect(
      owner.getByRole("button", { name: `Sign in as ${emailApp.runtime.ownerEmail}`, exact: true }),
    ).toBeVisible();
    expect((await ownerContext.cookies()).some((cookie) => cookie.name === SESSION_COOKIE)).toBe(false);
    expect(await owner.evaluate(async () => (await indexedDB.databases()).map((db) => db.name))).not.toContain(
      "kanbun",
    );
    await owner.getByRole("button", { name: `Sign in as ${emailApp.runtime.ownerEmail}`, exact: true }).click();
    await expect(owner.locator(".sync-indicator")).toContainText("Saved");
    expect(new URL(owner.url()).hash).toBe("#issues");
    const session = (await ownerContext.cookies()).find((cookie) => cookie.name === SESSION_COOKIE)!;
    expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
    expect(await owner.evaluate(() => document.cookie)).not.toContain(SESSION_COOKIE);
    if (!(await owner.getByRole("textbox", { name: "Issue title", exact: true }).isVisible()))
      await owner.getByRole("button", { name: "New issue" }).click();
    await owner.getByRole("textbox", { name: "Issue title", exact: true }).fill("Native owner work");
    await owner.getByRole("button", { name: "Create issue", exact: true }).click();
    await expect(owner.getByRole("button", { name: /Edit title for KAN-1/ })).toContainText("Native owner work");
    await expect(owner.locator(".sync-indicator")).toContainText("Saved");
    await owner.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(owner.getByRole("heading", { name: "Sign in to kanbun", exact: true })).toBeVisible();
    await expect(owner.getByText("Native owner work", { exact: true })).toHaveCount(0);
    expect((await ownerContext.cookies()).some((cookie) => cookie.name === SESSION_COOKIE)).toBe(false);
    await testInfo.attach("native-email-sign-in", {
      body: await owner.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  } finally {
    await Promise.allSettled([ownerContext.close(), otherContext.close()]);
  }
});

test("an email-only invite preserves its destination through sign-in and opens the targeted workspace", async ({
  browser,
  emailApp,
}) => {
  const ownerContext = await browser.newContext(),
    memberContext = await browser.newContext();
  await nativeBrowser(ownerContext);
  await nativeBrowser(memberContext);
  const owner = await ownerContext.newPage(),
    member = await memberContext.newPage();
  const memberEmail = "invited-member@datafog.ai";
  try {
    await loginEmail(owner, emailApp);
    await owner.getByRole("link", { name: "Members", exact: true }).click();
    await owner.getByText("Invite member", { exact: true }).click();
    await owner.getByRole("textbox", { name: "Invite by email", exact: true }).fill(memberEmail);
    await owner.getByRole("button", { name: "Create invitation", exact: true }).click();
    const invitationLink = owner.getByRole("textbox", { name: "Invitation link", exact: true });
    await expect(invitationLink).toBeVisible();
    const destination = new URL(await invitationLink.inputValue()).hash;
    // A real, valid session for another email must be switchable without losing the invitation.
    await loginEmail(member, emailApp);
    const cacheKeys = () =>
      member.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("kanbun");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          return await new Promise<string[]>((resolve, reject) => {
            const request = database.transaction("state", "readonly").objectStore("state").getAllKeys();
            request.onsuccess = () => resolve(request.result.map(String).sort());
            request.onerror = () => reject(request.error);
          });
        } finally {
          database.close();
        }
      });
    const beforeInvitation = await cacheKeys();
    await member.goto(`${emailApp.origin}/${destination}`);
    await expect(member.getByRole("alert")).toContainText("unavailable for this identity");
    await member.getByRole("button", { name: "Use another email", exact: true }).click();
    await expect(member.getByRole("heading", { name: "Sign in to kanbun", exact: true })).toBeVisible();
    expect(new URL(member.url()).hash).toBe(destination);
    const signIn = await requestEmail(member, emailApp, memberEmail, destination);
    expect(decodeURIComponent(signIn.hash.split("/").slice(2).join("/"))).toBe(destination);
    await consumeEmail(member, emailApp, memberEmail, signIn);
    await expect(member.getByRole("heading", { name: "Join Private preview", exact: true })).toBeVisible();
    expect(new URL(member.url()).hash).toBe(destination);
    // The previous owner's persisted state remains stored but no new workspace cache opens before acceptance.
    expect(await cacheKeys()).toEqual(beforeInvitation);
    await member.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await expect(member.locator(".sync-indicator")).toContainText("Saved");
    expect(new URL(member.url()).hash).toBe("#issues");
    await expect(member.getByRole("link", { name: "Members", exact: true })).toHaveCount(0);
    const context = await memberContext.request.get(`${emailApp.origin}/api/context`);
    expect(context.status()).toBe(200);
    expect((await context.json()) as WorkspaceContext).toMatchObject({
      email: memberEmail,
      role: "member",
      workspaceId: emailApp.runtime.workspaceId,
    });
  } finally {
    await Promise.allSettled([ownerContext.close(), memberContext.close()]);
  }
});

test("native expiry hides cached work while the same person can sign in again and recover the saved offline queue", async ({
  browser,
  emailApp,
}) => {
  const context = await browser.newContext();
  await nativeBrowser(context);
  const page = await context.newPage();
  const hints: number[] = [];
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname !== "/sync/connect") return;
    socket.on("framereceived", (frame) => {
      const value = JSON.parse(String(frame.payload)) as { type: string; seq: number };
      if (value.type === "poke") hints.push(value.seq);
    });
  });
  try {
    await loginEmail(page, emailApp);
    const identity = (await (await context.request.get(`${emailApp.origin}/api/context`)).json()) as WorkspaceContext;
    if (!(await page.getByRole("textbox", { name: "Issue title", exact: true }).isVisible()))
      await page.getByRole("button", { name: "New issue" }).click();
    await page.getByRole("textbox", { name: "Issue title", exact: true }).fill("Offline native task");
    await page.getByRole("button", { name: "Create issue", exact: true }).click();
    await expect(page.getByRole("button", { name: /Edit title for KAN-1/ })).toContainText("Offline native task");
    await expect(page.locator(".sync-indicator")).toContainText("Saved");
    const issueRows = (await (
      await context.request.get(`${emailApp.origin}/sync/bootstrap?clientId=native-idle-test`)
    ).json()) as BootstrapResponse;
    const issueId = String(issueRows.rows.issue![0]!.id);
    const peerEmail = "native-peer@datafog.ai";
    const invitation = await context.request.post(`${emailApp.origin}/api/invitations`, {
      headers: { Origin: emailApp.origin },
      data: { email: peerEmail },
    });
    expect(invitation.status()).toBe(200);
    const grant = (await invitation.json()) as { token: string };
    const peer = nativeAgent(emailApp.runtime);
    expect((await peer.requestLink(peerEmail)).status).toBe(202);
    const peerToken = linkToken(emailLink((await emailApp.runtime.capturedEmails()).at(-1)!));
    expect((await peer.consume(peerToken)).status).toBe(200);
    expect((await peer.json("/api/invitations/accept", { token: grant.token })).status).toBe(200);
    const changeFromPeer = async (id: number, priority: number) => {
      const response = await peer.json("/sync/push", {
        clientId: "native-browser-peer",
        mutations: [
          { id, name: "issueUpdate", args: { id: issueId, patch: { priority } }, ts: new Date().toISOString() },
        ],
      });
      const result = (await response.json()) as PushResponse;
      expect(result).toMatchObject({ ok: true, rejected: [] });
      return result;
    };
    await changeFromPeer(1, 1);
    await expect(page.getByRole("row", { name: "KAN-1", exact: true })).toContainText("Urgent");
    await expect(page.locator(".sync-indicator")).toContainText("Saved");
    await page.route("**/sync/push", (route) => route.abort("internetdisconnected"));
    // With all HTTP synchronization blocked, only the real server's WebSocket close can show sign-in.
    await page.route("**/sync/pull?**", (route) => route.abort("internetdisconnected"));
    await page.getByRole("button", { name: /Edit title for KAN-1/ }).click();
    const editor = page.getByRole("textbox", { name: "Title for KAN-1", exact: true });
    await editor.fill("Recovered native task");
    await editor.press("Enter");
    const key = persistedKey(identity);
    await expect.poll(async () => (await readWorkspaceState(page, key))?.pending.length).toBe(1);
    const session = (await context.cookies()).find((cookie) => cookie.name === SESSION_COOKIE)!;
    const beforeExpiry = Math.max(...hints);
    await emailApp.runtime.expireNativeSession(session.value);
    await changeFromPeer(2, 2);
    await expect(page.getByRole("heading", { name: "Sign in to kanbun", exact: true })).toBeVisible();
    await expect(page.getByText("Recovered native task", { exact: true })).toHaveCount(0);
    expect((await readWorkspaceState(page, key))?.pending).toHaveLength(1);
    expect(hints.some((seq) => seq > beforeExpiry)).toBe(false);
    await page.unroute("**/sync/push");
    await page.unroute("**/sync/pull?**");
    await loginEmail(page, emailApp);
    const renewed = (await (await context.request.get(`${emailApp.origin}/api/context`)).json()) as WorkspaceContext;
    expect(renewed.actor).toEqual(identity.actor);
    expect(renewed.workspaceId).toBe(identity.workspaceId);
    expect(renewed.admissionId).toBe(identity.admissionId);
    await expect(page.getByRole("button", { name: /Edit title for KAN-1/ })).toContainText("Recovered native task");
    await expect.poll(async () => (await readWorkspaceState(page, key))?.pending.length).toBe(0);
    await page.reload();
    await expect(page.getByRole("button", { name: /Edit title for KAN-1/ })).toContainText("Recovered native task");
  } finally {
    await context.close();
  }
});
