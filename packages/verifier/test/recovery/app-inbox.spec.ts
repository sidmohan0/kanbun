import { uuidv7 } from "@kanbun/model";
import type { BootstrapResponse, PushResponse, WorkspaceContext } from "@kanbun/sync";
import type { Locator, Page } from "@playwright/test";
import { test, expect, selectPrincipal, type MembershipHarness } from "./app-membership.fixture";
import { readWorkspaceState, syncApi } from "./app.fixture";

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
const inbox = (page: Page) => page.getByRole("region", { name: "Notifications", exact: true });
const commentRegion = (page: Page) => page.getByRole("region", { name: "Comments", exact: true });
async function admitted(app: MembershipHarness) {
  const owner = await app.runtime.context();
  const grant = await app.runtime.fetch("/api/invitations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: app.memberEmail }),
  });
  expect(grant.status).toBe(200);
  const invitation = (await grant.json()) as { token: string };
  const response = await app.runtime.fetch(
    "/api/invitations/accept",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: invitation.token }),
    },
    app.memberToken,
  );
  expect(response.status).toBe(200);
  const member = (await response.json()) as WorkspaceContext;
  const teamId = String((await app.runtime.inspect()).rows.team![0]!.id);
  return { owner, member, teamId };
}
async function push(app: MembershipHarness, mutations: { name: string; args: unknown }[]) {
  const response = await app.runtime.fetch("/sync/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientId: `inbox-fixture-${uuidv7()}`,
      mutations: mutations.map((mutation, index) => ({ ...mutation, id: index + 1, ts: new Date().toISOString() })),
    }),
  });
  expect(response.status).toBe(200);
  expect((await response.json()) as PushResponse).toMatchObject({ ok: true, rejected: [] });
}
async function open(page: Page, app: MembershipHarness, hash: string) {
  await page.goto(`${app.origin}/${hash}`);
  await expect(page.locator(".sync-indicator")).toContainText("Saved");
}
async function mention(form: Locator, userId: string) {
  await form.getByRole("combobox", { name: "Mention teammate", exact: true }).selectOption(userId);
  await form.getByRole("button", { name: "Add mention", exact: true }).click();
}
async function notifications(app: MembershipHarness) {
  const response = await app.runtime.fetch("/sync/bootstrap?clientId=inbox-proof", undefined, app.memberToken);
  expect(response.status).toBe(200);
  return ((await response.json()) as BootstrapResponse).rows.notification ?? [];
}

test("two verified people receive their own assignment and explicit mention updates, and read state survives reload", async ({
  browser,
  membership,
}, testInfo) => {
  const { owner: ownerIdentity, member, teamId } = await admitted(membership);
  const issueId = uuidv7();
  await push(membership, [
    {
      name: "issueCreate",
      args: {
        id: issueId,
        teamId,
        title: "Review the launch plan",
        assigneeId: member.actor.id,
        subscriptionId: uuidv7(),
      },
    },
  ]);
  const ownerContext = await browser.newContext(),
    memberContext = await browser.newContext();
  await selectPrincipal(ownerContext, membership.origin, "owner");
  await selectPrincipal(memberContext, membership.origin, "member");
  const owner = await ownerContext.newPage(),
    recipient = await memberContext.newPage();
  try {
    await Promise.all([open(owner, membership, `#issues/${issueId}`), open(recipient, membership, "#inbox")]);
    await expect(inbox(recipient).locator("li")).toHaveCount(1);
    await expect(inbox(recipient)).toContainText("assigned this issue to you");
    const form = owner.locator(".comment-compose");
    await form.getByRole("textbox", { name: "Add a comment", exact: true }).fill("Please review the release decision.");
    await mention(form, member.actor.id);
    await form.getByRole("button", { name: "Post comment", exact: true }).click();
    await expect(inbox(recipient).locator("li")).toHaveCount(2);
    const update = inbox(recipient).locator("li").filter({ hasText: "mentioned you" });
    await expect(update).toContainText("Review the launch plan");
    await expect(recipient.getByRole("link", { name: /Inbox.*2 unread notifications/ })).toBeVisible();
    await update.getByRole("button", { name: "Mark read", exact: true }).click();
    await expect(recipient.locator(".sync-indicator")).toContainText("Saved");
    await recipient.reload();
    await expect(
      inbox(recipient)
        .locator("li")
        .filter({ hasText: "mentioned you" })
        .getByRole("button", { name: "Mark unread", exact: true }),
    ).toBeVisible();
    await expect(inbox(recipient)).toContainText("1 unread");
    await inbox(recipient)
      .locator("li")
      .filter({ hasText: "mentioned you" })
      .getByRole("button", { name: "Mark unread", exact: true })
      .click();
    await expect(recipient.locator(".sync-indicator")).toContainText("Saved");
    await recipient.reload();
    await expect(inbox(recipient)).toContainText("2 unread");
    await update.getByRole("link", { name: "Review the launch plan", exact: true }).click();
    await expect(commentRegion(recipient)).toContainText("Please review the release decision.");
    await owner.getByRole("link", { name: /^Inbox/ }).click();
    await expect(inbox(owner)).toContainText("No updates in your inbox yet.");
    await commentRegion(recipient).getByRole("button", { name: "Reply", exact: true }).click();
    const reply = recipient.locator(".comment-reply");
    await reply.getByRole("textbox", { name: /^Reply to/ }).fill("The release decision is approved.");
    await mention(reply, ownerIdentity.actor.id);
    await reply.getByRole("button", { name: "Post reply", exact: true }).click();
    await expect(inbox(owner).locator("li")).toHaveCount(1);
    await expect(inbox(owner)).toContainText("mentioned you");
    await recipient.getByRole("link", { name: /^Inbox/ }).click();
    await testInfo.attach("workspace-inbox-desktop", {
      body: await recipient.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await recipient.setViewportSize({ width: 390, height: 844 });
    expect(await recipient.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await testInfo.attach("workspace-inbox-narrow", {
      body: await recipient.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  } finally {
    await Promise.allSettled([ownerContext.close(), memberContext.close()]);
  }
});

test("mention recipients on an offline comment edit survive reload, deliver once, and remain selected on later edits", async ({
  browser,
  membership,
}) => {
  const { owner: ownerIdentity, member, teamId } = await admitted(membership);
  const issueId = uuidv7();
  await push(membership, [
    { name: "issueCreate", args: { id: issueId, teamId, title: "Offline mention review", subscriptionId: uuidv7() } },
  ]);
  const context = await browser.newContext();
  await selectPrincipal(context, membership.origin, "owner");
  const owner = await context.newPage();
  try {
    await open(owner, membership, `#issues/${issueId}`);
    const compose = owner.locator(".comment-compose");
    await compose
      .getByRole("textbox", { name: "Add a comment", exact: true })
      .fill("Preview member: this typed name alone is plain text.");
    await compose.getByRole("button", { name: "Post comment", exact: true }).click();
    await expect(owner.locator(".sync-indicator")).toContainText("Saved");
    await expect.poll(async () => (await membership.runtime.notificationProgress()).settled).toBe(true);
    expect(await notifications(membership)).toHaveLength(0);
    await owner.route(syncApi, (route) => route.abort("internetdisconnected"));
    await commentRegion(owner).getByRole("button", { name: "Edit comment", exact: true }).click();
    const edit = owner
      .locator("form")
      .filter({ has: owner.getByRole("textbox", { name: "Edit comment", exact: true }) });
    await edit
      .getByRole("textbox", { name: "Edit comment", exact: true })
      .fill("Please review this saved offline request.");
    await mention(edit, member.actor.id);
    await edit.getByRole("button", { name: "Save comment", exact: true }).click();
    await expect
      .poll(async () =>
        (await readWorkspaceState(owner, stateKey(ownerIdentity)))?.pending.some(
          (mutation) => mutation.name === "commentUpdate",
        ),
      )
      .toBe(true);
    const pending = (await readWorkspaceState(owner, stateKey(ownerIdentity)))!.pending.find(
      (mutation) => mutation.name === "commentUpdate",
    )!;
    expect(pending.args).toMatchObject({ mentionedUserIds: [member.actor.id] });
    await owner.reload();
    await expect(commentRegion(owner)).toContainText("Please review this saved offline request.");
    await owner.unroute(syncApi);
    await owner.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect.poll(async () => (await readWorkspaceState(owner, stateKey(ownerIdentity)))?.pending.length).toBe(0);
    await expect.poll(async () => (await membership.runtime.notificationProgress()).settled).toBe(true);
    expect(await notifications(membership)).toHaveLength(1);
    await commentRegion(owner).getByRole("button", { name: "Edit comment", exact: true }).click();
    await expect(owner.getByRole("button", { name: "Remove mention of Preview member", exact: true })).toBeVisible();
    await owner
      .getByRole("textbox", { name: "Edit comment", exact: true })
      .fill("The same recipient remains selected after reconnect.");
    await owner.getByRole("button", { name: "Save comment", exact: true }).click();
    await expect(owner.locator(".sync-indicator")).toContainText("Saved");
    await expect.poll(async () => (await membership.runtime.notificationProgress()).settled).toBe(true);
    expect(await notifications(membership)).toHaveLength(1);
  } finally {
    await context.close();
  }
});

test("private-team access removal hides cached inbox updates and removes that person from explicit mention choices", async ({
  browser,
  membership,
}) => {
  const { member } = await admitted(membership);
  const teamId = uuidv7(),
    issueId = uuidv7();
  await push(membership, [
    {
      name: "teamCreate",
      args: {
        id: teamId,
        name: "Private inbox team",
        key: "PIV",
        visibility: "private",
        membershipId: uuidv7(),
        stateIds: { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() },
      },
    },
    { name: "teamMembershipCreate", args: { id: uuidv7(), teamId, userId: member.actor.id } },
    {
      name: "issueCreate",
      args: {
        id: issueId,
        teamId,
        title: "Private inbox material",
        assigneeId: member.actor.id,
        subscriptionId: uuidv7(),
      },
    },
  ]);
  const ownerContext = await browser.newContext(),
    memberContext = await browser.newContext();
  await selectPrincipal(ownerContext, membership.origin, "owner");
  await selectPrincipal(memberContext, membership.origin, "member");
  const owner = await ownerContext.newPage(),
    recipient = await memberContext.newPage();
  try {
    await Promise.all([open(owner, membership, `#issues/${issueId}`), open(recipient, membership, "#inbox")]);
    await expect(inbox(recipient)).toContainText("Private inbox material");
    await mention(owner.locator(".comment-compose"), member.actor.id);
    await push(membership, [{ name: "teamMembershipDelete", args: { teamId, userId: member.actor.id } }]);
    await expect(inbox(recipient).getByText("Private inbox material", { exact: true })).toHaveCount(0);
    await expect(inbox(recipient)).toContainText("No updates in your inbox yet.");
    await expect(
      owner
        .locator(".comment-compose")
        .getByRole("combobox", { name: "Mention teammate", exact: true })
        .locator(`option[value="${member.actor.id}"]`),
    ).toHaveCount(0);
    await owner
      .getByRole("textbox", { name: "Add a comment", exact: true })
      .fill("This recipient no longer has access.");
    await owner.getByRole("button", { name: "Post comment", exact: true }).click();
    await expect(commentRegion(owner).getByRole("alert")).toContainText("Remove unavailable mentions");
    await owner.getByRole("button", { name: "Remove mention of Preview member", exact: true }).click();
    await owner.getByRole("button", { name: "Post comment", exact: true }).click();
    await expect(owner.locator(".sync-indicator")).toContainText("Saved");
    await recipient.reload();
    await expect(inbox(recipient)).toContainText("No updates in your inbox yet.");
  } finally {
    await Promise.allSettled([ownerContext.close(), memberContext.close()]);
  }
});
