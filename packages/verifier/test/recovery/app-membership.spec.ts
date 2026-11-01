import { uuidv7 } from "@kanbun/model";
import { issueIncarnation, type PushResponse, type WorkspaceContext } from "@kanbun/sync";
import type { Page } from "@playwright/test";
import { test, expect, selectPrincipal, type MembershipHarness } from "./app-membership.fixture";
import { readWorkspaceState, syncApi } from "./app.fixture";
import { readDescriptionRecord } from "./document-storage";

type Grant = { token: string; url: string; invitation: { id: string; email: string } };

test("a verified person without membership is guided to their invitation without opening workspace storage", async ({
  browser,
  membership,
}) => {
  await membership.runtime.context();
  const context = await browser.newContext();
  await selectPrincipal(context, membership.origin, "member");
  const page = await context.newPage();
  const syncRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/sync/")) syncRequests.push(request.url());
  });
  try {
    await page.goto(membership.origin);
    await expect(page.getByRole("heading", { name: "Workspace access required", exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("Sign-in does not automatically grant workspace access");
    await expect(page.getByText(/Ask the workspace owner for an invitation link/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in again", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Check access again", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Workspace access required", exact: true })).toBeVisible();
    expect(syncRequests).toEqual([]);
    expect(
      await page.evaluate(async () => (await indexedDB.databases()).map((database) => database.name)),
    ).not.toContain("kanbun");
  } finally {
    await context.close();
  }
});

test("invitation retry checks a corrected identity and expired sign-in preserves the complete invitation", async ({
  browser,
  membership,
}) => {
  await membership.runtime.context();
  const grant = await invitation(membership);
  const context = await browser.newContext();
  await selectPrincipal(context, membership.origin, "outsider");
  const page = await context.newPage();
  try {
    await page.goto(`${membership.origin}/#invite/${encodeURIComponent(grant.token)}`);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: "Check invitation again", exact: true })).toBeVisible();
    await selectPrincipal(context, membership.origin, "member");
    await page.getByRole("button", { name: "Check invitation again", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Join Private preview", exact: true })).toBeVisible();
    await page.route("**/api/invitations/accept", (route) =>
      route.fulfill({
        status: 401,
        contentType: "text/html",
        body: "<p>Sign in</p>",
      }),
    );
    await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sign in to accept your invitation", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept invitation", exact: true })).toHaveCount(0);
    await page.unroute("**/api/invitations/accept");
    await page.getByRole("button", { name: "Sign in again", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Join Private preview", exact: true })).toBeVisible();
    expect(new URL(page.url()).hash).toBe(`#invite/${grant.token}`);
    await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await expect(page.locator(".sync-indicator")).toContainText("Saved");
    expect(new URL(page.url()).hash).toBe("#issues");
  } finally {
    await context.close();
  }
});
const stateKey = (context: WorkspaceContext) =>
  JSON.stringify([
    "v1",
    context.mode,
    context.workspaceId,
    context.actor.type,
    context.actor.id,
    "main",
    ...(context.admissionId ? [context.admissionId] : []),
  ]);
const descriptionKey = (context: WorkspaceContext, issue: { id: string; createdSeq: number; createdAt: string }) =>
  JSON.stringify([
    "v2",
    context.mode,
    context.workspaceId,
    context.actor.type,
    context.actor.id,
    "main",
    issue.id,
    issueIncarnation(issue),
    ...(context.admissionId ? [context.admissionId] : []),
  ]);
const description = (page: Page) => page.getByRole("textbox", { name: "Description", exact: true });
const descriptionStatus = (page: Page) => page.getByRole("status", { name: "Description status", exact: true });
async function openWorkspace(page: Page, app: MembershipHarness, fragment = "#issues"): Promise<WorkspaceContext> {
  const context = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/context");
  if (page.url().startsWith(app.origin + "/")) {
    // A hash-only goto can reuse the old module/identity. Identity-switch checks require a full reload.
    await page.evaluate((hash) => history.replaceState(null, "", hash), fragment);
    await page.reload();
  } else await page.goto(`${app.origin}/${fragment}`);
  const response = await context;
  expect(response.status()).toBe(200);
  const value = (await response.json()) as WorkspaceContext;
  await expect(page.locator(".sync-indicator")).toContainText("Saved");
  return value;
}
async function invitation(app: MembershipHarness, email = app.memberEmail): Promise<Grant> {
  const response = await app.runtime.fetch("/api/invitations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<Grant>;
}
async function acceptDirect(app: MembershipHarness, grant: Grant): Promise<WorkspaceContext> {
  const response = await app.runtime.fetch(
    "/api/invitations/accept",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: grant.token }) },
    app.memberToken,
  );
  expect(response.status).toBe(200);
  return response.json() as Promise<WorkspaceContext>;
}
async function inviteThroughUi(page: Page, app: MembershipHarness): Promise<Grant> {
  await page.getByRole("link", { name: "Members", exact: true }).click();
  await expect(page.getByRole("heading", { name: "People with access", exact: true })).toBeVisible();
  await page.getByText("Invite member", { exact: true }).click();
  await page.getByRole("textbox", { name: "Invite by email", exact: true }).fill(app.memberEmail);
  const created = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/invitations" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create invitation", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(200);
  const result = (await response.json()) as Grant;
  await expect(page.getByRole("textbox", { name: "Invitation link", exact: true })).toHaveValue(result.url);
  return result;
}
async function acceptThroughUi(page: Page, app: MembershipHarness, grant: Grant): Promise<WorkspaceContext> {
  await page.goto(`${app.origin}/#invite/${encodeURIComponent(grant.token)}`);
  await expect(page.getByRole("heading", { name: "Join Private preview", exact: true })).toBeVisible();
  const context = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/context");
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
  const response = await context;
  expect(response.status()).toBe(200);
  await expect(page.locator(".sync-indicator")).toContainText("Saved");
  return response.json() as Promise<WorkspaceContext>;
}
async function push(app: MembershipHarness, mutations: { name: string; args: unknown }[]) {
  const response = await app.runtime.fetch("/sync/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientId: `membership-browser-fixture-${uuidv7()}`,
      mutations: mutations.map((mutation, index) => ({ ...mutation, id: index + 1, ts: new Date().toISOString() })),
    }),
  });
  expect(response.status).toBe(200);
  expect((await response.json()) as PushResponse).toMatchObject({ ok: true, rejected: [] });
}

test("the owner can invite a verified teammate who joins before workspace initialization and converges independently", async ({
  browser,
  membership,
}, testInfo) => {
  const ownerContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const memberContext = await browser.newContext();
  await selectPrincipal(ownerContext, membership.origin, "owner");
  await selectPrincipal(memberContext, membership.origin, "member");
  const owner = await ownerContext.newPage();
  const member = await memberContext.newPage();
  try {
    const ownerIdentity = await openWorkspace(owner, membership);
    expect(ownerIdentity.role).toBe("owner");
    expect(ownerIdentity.admissionId).toBeNull();
    const grant = await inviteThroughUi(owner, membership);
    await owner.getByRole("button", { name: "Copy invitation link", exact: true }).click();
    await expect(owner.getByRole("status", { name: "Invitation copy status", exact: true })).toContainText("copied");
    expect(await owner.evaluate(() => navigator.clipboard.readText())).toBe(grant.url);
    const beforeAcceptance: string[] = [];
    member.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/context") beforeAcceptance.push(request.url());
    });
    await member.goto(`${membership.origin}/#invite/${encodeURIComponent(grant.token)}`);
    await expect(member.getByRole("heading", { name: "Join Private preview", exact: true })).toBeVisible();
    expect(beforeAcceptance).toEqual([]);
    expect(
      await member.evaluate(async () => (await indexedDB.databases()).map((database) => database.name)),
    ).not.toContain("kanbun");
    await testInfo.attach("invitation-before-workspace", {
      body: await member.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    const joinedResponse = member.waitForResponse((response) => new URL(response.url()).pathname === "/api/context");
    await member.getByRole("button", { name: "Accept invitation", exact: true }).click();
    const joined = (await (await joinedResponse).json()) as WorkspaceContext;
    expect(joined.role).toBe("member");
    expect(joined.actor.id).not.toBe(ownerIdentity.actor.id);
    expect(joined.admissionId).toBeTruthy();
    await expect(member.getByRole("link", { name: "Members", exact: true })).toHaveCount(0);
    await expect(member.locator(".sync-indicator")).toContainText("Saved");
    await owner.getByRole("link", { name: /^All issues(?: \d+)?$/ }).click();
    if (!(await owner.getByRole("textbox", { name: "Issue title", exact: true }).isVisible()))
      await owner.getByRole("button", { name: "New issue" }).click();
    await owner.getByRole("textbox", { name: "Issue title", exact: true }).fill("Shared team work");
    await owner.getByRole("button", { name: "Create issue", exact: true }).click();
    await expect(member.getByRole("row", { name: "KAN-1", exact: true })).toContainText("Shared team work");
    await member.getByRole("button", { name: "Edit title for KAN-1", exact: true }).click();
    await member.getByRole("textbox", { name: "Title for KAN-1", exact: true }).fill("Updated by the invited teammate");
    await member.getByRole("button", { name: "Save title", exact: true }).click();
    await expect(owner.getByRole("row", { name: "KAN-1", exact: true })).toContainText(
      "Updated by the invited teammate",
    );
    const saved = await membership.runtime.inspect();
    expect(
      saved.events.some(
        (event) => event.type === "IssueTitled" && JSON.parse(String(event.actor)).id === joined.actor.id,
      ),
    ).toBe(true);
    expect((await readWorkspaceState(owner, stateKey(ownerIdentity)))?.userId).toBe(ownerIdentity.actor.id);
    expect((await readWorkspaceState(member, stateKey(joined)))?.userId).toBe(joined.actor.id);
    const administrativeRequests: string[] = [];
    member.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/members") administrativeRequests.push(request.url());
    });
    await member.goto(`${membership.origin}/#members`);
    await expect(member.getByRole("heading", { name: "Workspace owner access required", exact: true })).toBeVisible();
    expect(administrativeRequests).toEqual([]);
    const denied = await member.evaluate(async (ownerId) => {
      const results = [await fetch("/api/members").then((response) => response.status)];
      for (const [path, body] of [
        ["/api/invitations", { email: "someone@example.com" }],
        ["/api/members/remove", { userId: ownerId }],
      ])
        results.push(
          await fetch(path as string, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }).then((response) => response.status),
        );
      return results;
    }, ownerIdentity.actor.id);
    expect(denied).toEqual([403, 403, 403]);
  } finally {
    await Promise.allSettled([ownerContext.close(), memberContext.close()]);
  }
});

test("switching between two admitted identities on one origin never opens or submits the other person's queue", async ({
  browser,
  membership,
}) => {
  await membership.runtime.context();
  const grant = await invitation(membership);
  const joined = await acceptDirect(membership, grant);
  const context = await browser.newContext();
  await selectPrincipal(context, membership.origin, "owner");
  const page = await context.newPage();
  try {
    const ownerIdentity = await openWorkspace(page, membership);
    await page.route(syncApi, (route) => route.abort("internetdisconnected"));
    if (!(await page.getByRole("textbox", { name: "Issue title", exact: true }).isVisible()))
      await page.getByRole("button", { name: "New issue" }).click();
    await page.getByRole("textbox", { name: "Issue title", exact: true }).fill("Owner's private pending queue");
    await page.getByRole("button", { name: "Create issue", exact: true }).click();
    const ownerKey = stateKey(ownerIdentity);
    await expect.poll(async () => (await readWorkspaceState(page, ownerKey))?.pending.length).toBe(1);
    const ownerPending = (await readWorkspaceState(page, ownerKey))!.pending;
    await selectPrincipal(context, membership.origin, "member");
    await page.unroute(syncApi);
    const memberIdentity = await openWorkspace(page, membership);
    expect(memberIdentity.actor.id).toBe(joined.actor.id);
    await expect(page.getByText("Owner's private pending queue", { exact: true })).toHaveCount(0);
    expect((await readWorkspaceState(page, ownerKey))?.pending).toEqual(ownerPending);
    expect((await readWorkspaceState(page, stateKey(memberIdentity)))?.pending).toEqual([]);
    expect(
      (await membership.runtime.inspect()).rows.issue?.some((issue) => issue.title === "Owner's private pending queue"),
    ).not.toBe(true);
    await selectPrincipal(context, membership.origin, "owner");
    await openWorkspace(page, membership);
    await expect(page.getByRole("row", { name: "KAN-1", exact: true })).toContainText("Owner's private pending queue");
    await expect.poll(async () => (await readWorkspaceState(page, ownerKey))?.pending.length).toBe(0);
  } finally {
    await Promise.allSettled([context.close()]);
  }
});

test("removal hides idle browser caches and a fresh admission preserves but never reopens or submits prior private drafts", async ({
  browser,
  membership,
}) => {
  await membership.runtime.context();
  const grant = await invitation(membership);
  const firstAdmission = await acceptDirect(membership, grant);
  const teamId = uuidv7();
  const issueId = uuidv7();
  await push(membership, [
    {
      name: "teamCreate",
      args: {
        id: teamId,
        name: "Private team",
        key: "PRV",
        visibility: "private",
        membershipId: uuidv7(),
        stateIds: { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() },
      },
    },
    { name: "teamMembershipCreate", args: { id: uuidv7(), teamId, userId: firstAdmission.actor.id } },
    { name: "issueCreate", args: { id: issueId, teamId, title: "Private team issue", subscriptionId: uuidv7() } },
  ]);
  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  await selectPrincipal(ownerContext, membership.origin, "owner");
  await selectPrincipal(memberContext, membership.origin, "member");
  const owner = await ownerContext.newPage();
  const member = await memberContext.newPage();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await openWorkspace(owner, membership, `#issues/${issueId}`);
    await description(owner).fill("Private team body before removal.");
    await expect(descriptionStatus(owner)).toHaveText("Saved");
    await openWorkspace(member, membership, `#issues/${issueId}`);
    await expect(description(member)).toHaveValue("Private team body before removal.");
    const issue = (await membership.runtime.inspect()).rows.issue!.find((candidate) => candidate.id === issueId)!;
    const oldDescriptionKey = descriptionKey(firstAdmission, {
      id: issueId,
      createdSeq: Number(issue.createdSeq),
      createdAt: String(issue.createdAt),
    });
    await member.route(
      (url) => url.pathname === "/sync/document" || url.pathname === "/sync/push",
      async (route) => {
        if (route.request().method() === "POST") await held;
        await route.continue().catch(() => {});
      },
    );
    await description(member).fill("Private draft from the old admission must stay unopened.");
    await expect.poll(async () => (await readDescriptionRecord(member, oldDescriptionKey))?.pending).toBe(true);
    const oldDocument = await readDescriptionRecord(member, oldDescriptionKey);
    await member.getByRole("link", { name: /^All issues(?: \d+)?$/ }).click();
    if (!(await member.getByRole("textbox", { name: "Issue title", exact: true }).isVisible()))
      await member.getByRole("button", { name: "New issue" }).click();
    await member.getByRole("textbox", { name: "Issue title", exact: true }).fill("Prior admission pending issue");
    await member.getByRole("button", { name: "Create issue", exact: true }).click();
    const oldKey = stateKey(firstAdmission);
    await expect.poll(async () => (await readWorkspaceState(member, oldKey))?.pending.length).toBe(1);
    const oldPending = (await readWorkspaceState(member, oldKey))!.pending;
    await owner.getByRole("link", { name: "Members", exact: true }).click();
    await owner.getByRole("button", { name: `Remove member ${membership.memberEmail}`, exact: true }).click();
    // No focus or Refresh action on the removed member: the server's policy close hides its cache.
    await expect(member.getByRole("alert")).toContainText("Sign in again");
    await expect(member.getByText("Private team issue", { exact: true })).toHaveCount(0);
    await expect(member.getByText("Prior admission pending issue", { exact: true })).toHaveCount(0);
    expect((await readWorkspaceState(member, oldKey))?.pending).toEqual(oldPending);
    expect(await readDescriptionRecord(member, oldDescriptionKey)).toEqual(oldDocument);
    const fresh = await inviteThroughUi(owner, membership);
    const admitted = await acceptThroughUi(member, membership, fresh);
    expect(admitted.actor.id).toBe(firstAdmission.actor.id);
    expect(admitted.admissionId).not.toBe(firstAdmission.admissionId);
    await expect(member.getByText("Private team issue", { exact: true })).toHaveCount(0);
    await expect(member.getByText("Prior admission pending issue", { exact: true })).toHaveCount(0);
    expect((await readWorkspaceState(member, oldKey))?.pending).toEqual(oldPending);
    expect(await readDescriptionRecord(member, oldDescriptionKey)).toEqual(oldDocument);
    expect((await readWorkspaceState(member, stateKey(admitted)))?.pending).toEqual([]);
    release();
    await member.unrouteAll({ behavior: "ignoreErrors" });
    const stale = await member.evaluate(
      async (oldAdmissionId) =>
        fetch("/sync/bootstrap?clientId=stale-admission-probe", {
          headers: { "X-Kanbun-Admission": oldAdmissionId! },
        }).then((response) => response.status),
      firstAdmission.admissionId,
    );
    expect(stale).toBe(403);
    const documentRequests: string[] = [];
    member.on("request", (request) => {
      if (new URL(request.url()).pathname === "/sync/document") documentRequests.push(request.url());
    });
    await member.goto(`${membership.origin}/#issues/${issueId}`);
    await expect(member.getByRole("heading", { name: "Issue unavailable", exact: true })).toBeVisible();
    await expect(description(member)).toHaveCount(0);
    expect(documentRequests).toEqual([]);
    expect(
      (await membership.runtime.inspect()).rows.issue?.some(
        (candidate) => candidate.title === "Prior admission pending issue",
      ),
    ).not.toBe(true);
  } finally {
    release();
    await Promise.allSettled([member.unrouteAll({ behavior: "ignoreErrors" })]);
    await Promise.allSettled([ownerContext.close(), memberContext.close()]);
  }
});

test("wrong-recipient, revoked, expired and invalid invitations never open cached workspace data", async ({
  browser,
  membership,
}) => {
  await membership.runtime.context();
  const grant = await invitation(membership);
  const context = await browser.newContext();
  const page = await context.newPage();
  const opened: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/context") opened.push(request.url());
  });
  try {
    await selectPrincipal(context, membership.origin, "outsider");
    await page.goto(`${membership.origin}/#invite/${encodeURIComponent(grant.token)}`);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept invitation", exact: true })).toHaveCount(0);
    const revoked = await membership.runtime.fetch("/api/invitations/revoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: grant.invitation.id }),
    });
    expect(revoked.status).toBe(200);
    await selectPrincipal(context, membership.origin, "member");
    await page.reload();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept invitation", exact: true })).toHaveCount(0);
    const expired = await invitation(membership);
    await membership.runtime.expireInvitation(expired.invitation.id);
    await page.goto(`${membership.origin}/#invite/${encodeURIComponent(expired.token)}`);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept invitation", exact: true })).toHaveCount(0);
    await page.goto(`${membership.origin}/#invite/invalid-token`);
    await expect(page.getByRole("alert")).toBeVisible();
    expect(opened).toEqual([]);
    await expect(page.getByRole("textbox", { name: "Issue title", exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(async () => (await indexedDB.databases()).map((database) => database.name)),
    ).not.toContain("kanbun");
  } finally {
    await Promise.allSettled([context.close()]);
  }
});
