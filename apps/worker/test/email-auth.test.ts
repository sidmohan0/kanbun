import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { uuidv7, type Row } from "@kanbun/model";
import { issueIncarnation, type BootstrapResponse, type PushResponse, type WorkspaceContext } from "@kanbun/sync";
import { emailLink, linkToken, nativeAgent, startEmailRuntime, LOGIN_COOKIE, SESSION_COOKIE } from "./email-runtime";

const jsonBody = (value: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
async function signIn(
  runtime: Awaited<ReturnType<typeof startEmailRuntime>>,
  agent: ReturnType<typeof nativeAgent>,
  email: string,
) {
  const before = (await runtime.capturedEmails()).length;
  expect((await agent.requestLink(email)).status).toBe(202);
  const messages = await runtime.capturedEmails();
  expect(messages).toHaveLength(before + 1);
  const token = linkToken(emailLink(messages.at(-1)!));
  expect((await agent.inspect(token)).status).toBe(200);
  expect((await agent.consume(token)).status).toBe(200);
  return token;
}

it("returns uniform request responses with nonce-bound single-use links and hashed credentials", async () => {
  const runtime = await startEmailRuntime();
  const browser = nativeAgent(runtime),
    otherBrowser = nativeAgent(runtime);
  try {
    const config = await browser.fetch("/api/auth/config");
    expect(await config.json()).toMatchObject({ method: "email", authenticated: false, siteKey: "fixture-site-key" });
    for (const path of [
      "/api/context",
      "/sync/bootstrap?clientId=anonymous",
      "/sync/document?issueId=missing",
      "/api/members",
    ])
      expect((await browser.fetch(path)).status).toBe(401);
    expect((await runtime.nativeConnect("anonymous", "")).status).not.toBe(101);
    const unknown = await browser.requestLink("unknown@datafog.ai");
    expect(unknown.status).toBe(202);
    const generic = await unknown.json();
    const outsideDomain = await browser.requestLink("outsider@other.example");
    expect(outsideDomain.status).toBe(202);
    expect(await outsideDomain.json()).toEqual(generic);
    expect(await runtime.capturedEmails()).toHaveLength(0);
    for (const token of ["invalid-token", "fixture-wrong-host", "fixture-wrong-action"]) {
      expect((await browser.requestLink(runtime.ownerEmail, "#issues", token)).ok).toBe(false);
      expect(await runtime.capturedEmails()).toHaveLength(0);
    }
    expect(
      (
        await browser.json(
          "/api/auth/request",
          { email: runtime.ownerEmail, returnTo: "#issues", turnstileToken: "fixture-human-token" },
          {},
          false,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await browser.json(
          "/api/auth/request",
          { email: runtime.ownerEmail, returnTo: "#issues", turnstileToken: "fixture-human-token" },
          { headers: { Origin: "https://attacker.example.test" } },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await browser.fetch("/api/auth/request", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: "{}",
        })
      ).ok,
    ).toBe(false);
    const requested = await browser.requestLink(runtime.ownerEmail, "#issues");
    expect(requested.status).toBe(202);
    expect(await requested.json()).toEqual(generic);
    const nonceCookie = requested.headers.getSetCookie().find((cookie) => cookie.startsWith(`${LOGIN_COOKIE}=`))!;
    for (const flag of ["Secure", "HttpOnly", "SameSite=Lax", "Path=/"]) expect(nonceCookie).toContain(flag);
    const message = (await runtime.capturedEmails()).at(-1)!;
    const link = emailLink(message),
      token = linkToken(link);
    expect(link.origin).toBe(runtime.appOrigin);
    expect(link.hash).toContain("/%23issues");
    // A scanner GET and a different browser must not consume the user's link.
    expect((await otherBrowser.fetch("/api/auth/consume?token=" + encodeURIComponent(token))).status).not.toBe(200);
    expect((await otherBrowser.inspect(token)).status).toBe(401);
    expect((await otherBrowser.consume(token)).status).toBe(401);
    const inspected = await browser.inspect(token);
    expect(inspected.status).toBe(200);
    const detail = (await inspected.json()) as { email: string; expiresAt: string };
    expect(detail.email).toBe(runtime.ownerEmail);
    const before = await runtime.authRows();
    expect(before.links).toHaveLength(1);
    expect(Date.parse(String(before.links[0]!.expires_at)) - Date.parse(String(before.links[0]!.created_at))).toBe(
      1_800_000,
    );
    expect(JSON.stringify(before)).not.toContain(token);
    expect(JSON.stringify(before)).not.toContain(browser.cookies.get(LOGIN_COOKIE));
    expect(before.links[0]!.token_hash).toBe(hash(token));
    expect(before.links[0]!.consumed_at).toBeNull();
    const results = await Promise.all([browser.consume(token), browser.consume(token)]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 401]);
    const successful = results.find((response) => response.status === 200)!;
    const sessionCookie = successful.headers.getSetCookie().find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`))!;
    for (const flag of ["Secure", "HttpOnly", "SameSite=Lax", "Path=/"]) expect(sessionCookie).toContain(flag);
    const rawSession = sessionCookie.split(";", 1)[0]!.slice(SESSION_COOKIE.length + 1);
    browser.cookies.set(SESSION_COOKIE, rawSession);
    const rows = await runtime.authRows();
    expect(rows.sessions).toHaveLength(1);
    expect(rows.sessions[0]!.id).toBe(hash(rawSession));
    expect(Date.parse(String(rows.sessions[0]!.expires_at)) - Date.parse(String(rows.sessions[0]!.created_at))).toBe(
      30 * 24 * 60 * 60 * 1000,
    );
    expect(JSON.stringify(rows)).not.toContain(rawSession);
    expect((await browser.consume(token)).status).toBe(401);
    expect((await browser.fetch("/api/context")).status).toBe(200);
    // Expired links cannot be inspected or consumed, even with the original nonce.
    const expiring = nativeAgent(runtime);
    await expiring.requestLink(runtime.ownerEmail);
    const expiredToken = linkToken(emailLink((await runtime.capturedEmails()).at(-1)!));
    await runtime.expireNativeLinks();
    expect((await expiring.inspect(expiredToken)).status).toBe(401);
    expect((await expiring.consume(expiredToken)).status).toBe(401);
    // Native mode never accepts the legacy assertion or a fabricated cookie.
    expect((await runtime.fetch("/api/context", {}, await runtime.token())).status).toBe(401);
    expect((await otherBrowser.fetch("/api/context", { headers: { Cookie: `${SESSION_COOKIE}=forged` } })).status).toBe(
      401,
    );
    await runtime.setEmailProviderFailure(true);
    const knownFailure = await browser.requestLink(runtime.ownerEmail);
    const unknownFailure = await otherBrowser.requestLink("unknown@datafog.ai");
    expect(knownFailure.status).toBe(202);
    expect(unknownFailure.status).toBe(202);
    expect(await knownFailure.json()).toEqual(generic);
    expect(await unknownFailure.json()).toEqual(generic);
    for (const response of [knownFailure, unknownFailure]) {
      const responseCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${LOGIN_COOKIE}=`))!;
      for (const flag of ["Secure", "HttpOnly", "SameSite=Lax", "Path=/"]) expect(responseCookie).toContain(flag);
    }
    const failedToken = linkToken(emailLink((await runtime.capturedEmails()).at(-1)!));
    expect((await runtime.authRows()).links.some((row) => row.token_hash === hash(failedToken))).toBe(false);
    expect((await browser.inspect(failedToken)).status).toBe(401);
    expect(JSON.stringify(runtime.authLogs())).toContain("kanbun.auth.delivery_failed");
    expect(JSON.stringify(runtime.authLogs())).not.toContain("fixture-private-provider-detail");
    expect(JSON.stringify(runtime.authLogs())).not.toContain("fixture-resend-secret");
  } finally {
    await runtime.close();
  }
}, 30000);

it("expires inactive sessions without extending them for background requests and renews only valid activity", async () => {
  const runtime = await startEmailRuntime();
  const browser = nativeAgent(runtime);
  const day = 24 * 60 * 60 * 1000;
  try {
    await signIn(runtime, browser, runtime.ownerEmail);
    const raw = browser.cookies.get(SESSION_COOKIE)!;
    const expiry = new Date(Date.now() + 15 * day).toISOString();
    const seen = new Date(Date.now() - 13 * day).toISOString();
    await runtime.setNativeSessionTimes(raw, seen, expiry);
    expect((await browser.fetch("/api/auth/config")).status).toBe(200);
    expect((await browser.fetch("/api/context")).status).toBe(200);
    expect((await runtime.authRows()).sessions[0]!.last_seen_at).toBe(seen);
    expect(
      (await browser.json("/api/auth/activity", {}, { headers: { Origin: "https://attacker.example.test" } })).status,
    ).toBe(403);
    expect((await browser.json("/api/auth/activity", {})).status).toBe(200);
    const renewed = (await runtime.authRows()).sessions[0]!;
    expect(Date.parse(String(renewed.last_seen_at))).toBeGreaterThan(Date.parse(seen));
    expect(renewed.expires_at).toBe(expiry);
    await runtime.setNativeSessionTimes(raw, new Date(Date.now() - 14 * day - 1000).toISOString(), expiry);
    expect((await browser.fetch("/api/context")).status).toBe(401);
    expect((await browser.json("/api/auth/activity", {})).status).toBe(401);
    expect((await runtime.nativeConnect("inactive", browser.cookieHeader())).status).not.toBe(101);
    await runtime.setNativeSessionTimes(raw, new Date().toISOString(), new Date(Date.now() - 1000).toISOString());
    expect((await browser.json("/api/auth/activity", {})).status).toBe(401);
  } finally {
    await runtime.close();
  }
}, 30000);

it("cuts over the existing owner and invited member without changing identity or resurrecting revoked membership", async () => {
  const runtime = await startEmailRuntime({ initialAuthMode: "preview" });
  try {
    const ownerBefore = await runtime.context();
    const existing = await runtime.inspect();
    const teamId = String(existing.rows.team![0]!.id),
      issueId = uuidv7();
    const created = await runtime.fetch(
      "/sync/push",
      jsonBody({
        clientId: "before-native",
        mutations: [
          {
            id: 1,
            name: "issueCreate",
            ts: new Date().toISOString(),
            args: { id: issueId, teamId, title: "Existing workspace work", subscriptionId: uuidv7() },
          },
        ],
      }),
    );
    expect((await created.json()) as PushResponse).toMatchObject({ ok: true, rejected: [] });
    const invitation = await runtime.fetch("/api/invitations", jsonBody({ email: "member@datafog.ai" }));
    const grant = (await invitation.json()) as { token: string; invitation: { id: string } };
    const memberAssertion = await runtime.token({
      sub: "existing-member-subject",
      email: "member@datafog.ai",
      name: "Member",
    });
    const admitted = await runtime.fetch("/api/invitations/accept", jsonBody({ token: grant.token }), memberAssertion);
    expect(admitted.status).toBe(200);
    const memberBefore = (await admitted.json()) as WorkspaceContext;
    await runtime.setAuthenticationMode("email");
    const owner = nativeAgent(runtime),
      member = nativeAgent(runtime);
    expect((await runtime.fetch("/api/context", {}, await runtime.token())).status).toBe(401);
    await signIn(runtime, owner, runtime.ownerEmail);
    await signIn(runtime, member, "member@datafog.ai");
    expect((await owner.json("/api/invitations", { email: "outsider@other.example" })).status).toBe(400);
    const ownerAfter = (await (await owner.fetch("/api/context")).json()) as WorkspaceContext;
    const memberAfter = (await (await member.fetch("/api/context")).json()) as WorkspaceContext;
    expect(ownerAfter).toMatchObject({
      workspaceId: ownerBefore.workspaceId,
      actor: ownerBefore.actor,
      role: "owner",
      admissionId: ownerBefore.admissionId,
    });
    expect(memberAfter).toMatchObject({
      workspaceId: memberBefore.workspaceId,
      actor: memberBefore.actor,
      role: "member",
      admissionId: memberBefore.admissionId,
    });
    const bootstrap = (await (
      await member.fetch("/sync/bootstrap?clientId=native-member-reader")
    ).json()) as BootstrapResponse;
    expect(bootstrap.rows.issue).toContainEqual(
      expect.objectContaining({ id: issueId, title: "Existing workspace work" }),
    );
    const rows = await runtime.authRows();
    expect(rows.accounts).toHaveLength(2);
    expect(rows.identities.filter((row) => row.provider === "cloudflare-access")).toHaveLength(2);
    expect(rows.identities.filter((row) => row.provider === "email")).toHaveLength(2);
    const memberSocket = await runtime.nativeConnect("native-member-socket", member.cookieHeader());
    expect(memberSocket.status).toBe(101);
    await expect.poll(() => memberSocket.connection!.messages.length).toBeGreaterThan(0);
    const beforeRemoval = Math.max(
      ...memberSocket.connection!.messages.map((message) => Number((message as { seq: number }).seq)),
    );
    expect((await owner.json("/api/members/remove", { userId: memberAfter.actor.id })).status).toBe(200);
    expect(
      await (
        await owner.json("/sync/push", {
          clientId: "before-native",
          mutations: [
            {
              id: 2,
              name: "issueUpdate",
              ts: new Date().toISOString(),
              args: { id: issueId, patch: { title: "Active members only" } },
            },
          ],
        })
      ).json(),
    ).toMatchObject({ ok: true, rejected: [] });
    expect(await memberSocket.connection!.closed).toEqual({
      code: 1008,
      reason: "Workspace access is no longer available",
    });
    expect(
      memberSocket.connection!.messages.some((message) => Number((message as { seq: number }).seq) > beforeRemoval),
    ).toBe(false);
    expect((await member.fetch("/api/context")).status).toBe(403);
    expect((await member.fetch(`/sync/document?issueId=${issueId}`)).status).toBe(403);
    const mailCount = (await runtime.capturedEmails()).length;
    expect((await member.requestLink("member@datafog.ai")).status).toBe(202);
    expect(await runtime.capturedEmails()).toHaveLength(mailCount);
    expect((await member.fetch("/api/context")).status).toBe(403);
    const reInvitation = await owner.json("/api/invitations", { email: "member@datafog.ai" });
    expect(reInvitation.status).toBe(200);
    const renewedGrant = (await reInvitation.json()) as { token: string };
    const readmitted = nativeAgent(runtime);
    await signIn(runtime, readmitted, "member@datafog.ai");
    expect((await readmitted.fetch("/api/context")).status).toBe(403);
    const accepted = await readmitted.json("/api/invitations/accept", { token: renewedGrant.token });
    expect(accepted.status).toBe(200);
    expect((await accepted.json()) as WorkspaceContext).toMatchObject({ actor: memberBefore.actor, role: "member" });
  } finally {
    await runtime.close();
  }
}, 30000);

it("revokes only the logged-out device and enforces native session expiry on HTTP, document and WebSocket paths", async () => {
  const runtime = await startEmailRuntime();
  const first = nativeAgent(runtime),
    second = nativeAgent(runtime);
  try {
    await signIn(runtime, first, runtime.ownerEmail);
    await signIn(runtime, second, runtime.ownerEmail);
    const initialized = (await (
      await first.fetch("/sync/bootstrap?clientId=native-owner")
    ).json()) as BootstrapResponse;
    const issueId = uuidv7();
    expect(
      (
        await first.json("/sync/push", {
          clientId: "native-owner-writes",
          mutations: [
            {
              id: 1,
              name: "issueCreate",
              ts: new Date().toISOString(),
              args: {
                id: issueId,
                teamId: initialized.rows.team![0]!.id,
                title: "Native session work",
                subscriptionId: uuidv7(),
              },
            },
          ],
        })
      ).status,
    ).toBe(200);
    const rows = (await (
      await first.fetch("/sync/bootstrap?clientId=native-document-reader")
    ).json()) as BootstrapResponse;
    const issue = rows.rows.issue!.find((row) => row.id === issueId) as Row<"issue">;
    const documentPath = `/sync/document?issueId=${issueId}&incarnation=${encodeURIComponent(issueIncarnation(issue))}`;
    expect((await first.fetch(documentPath)).status).toBe(200);
    const connected = await runtime.nativeConnect("native-session-owner", first.cookieHeader());
    expect(connected.status).toBe(101);
    expect((await first.json("/api/auth/logout", {}, {}, false)).status).toBe(403);
    await expect.poll(() => connected.connection!.messages.length).toBeGreaterThan(0);
    const beforeLogout = Math.max(
      ...connected.connection!.messages.map((message) => Number((message as { seq: number }).seq)),
    );
    const oldCookie = first.cookieHeader();
    expect((await first.logout()).status).toBe(200);
    expect(
      await (
        await second.json("/sync/push", {
          clientId: "native-owner-writes",
          mutations: [
            {
              id: 2,
              name: "issueUpdate",
              ts: new Date().toISOString(),
              args: { id: issueId, patch: { title: "Second device after logout" } },
            },
          ],
        })
      ).json(),
    ).toMatchObject({ ok: true, rejected: [] });
    expect(await connected.connection!.closed).toEqual({ code: 1008, reason: "Workspace identity has expired" });
    expect(
      connected.connection!.messages.some((message) => Number((message as { seq: number }).seq) > beforeLogout),
    ).toBe(false);
    expect((await first.fetch("/api/context", { headers: { Cookie: oldCookie } })).status).toBe(401);
    expect((await first.fetch(documentPath, { headers: { Cookie: oldCookie } })).status).toBe(401);
    expect((await second.fetch("/api/context")).status).toBe(200);
    const secondSocket = await runtime.nativeConnect("native-second-owner", second.cookieHeader());
    expect(secondSocket.status).toBe(101);
    await expect.poll(() => secondSocket.connection!.messages.length).toBeGreaterThan(0);
    const beforeExpiry = Math.max(
      ...secondSocket.connection!.messages.map((message) => Number((message as { seq: number }).seq)),
    );
    await runtime.expireNativeSession(second.cookies.get(SESSION_COOKIE)!);
    const third = nativeAgent(runtime);
    await signIn(runtime, third, runtime.ownerEmail);
    expect(
      await (
        await third.json("/sync/push", {
          clientId: "native-owner-writes",
          mutations: [
            {
              id: 3,
              name: "issueUpdate",
              ts: new Date().toISOString(),
              args: { id: issueId, patch: { title: "Third device after expiry" } },
            },
          ],
        })
      ).json(),
    ).toMatchObject({ ok: true, rejected: [] });
    expect(await secondSocket.connection!.closed).toEqual({ code: 1008, reason: "Workspace identity has expired" });
    expect(
      secondSocket.connection!.messages.some((message) => Number((message as { seq: number }).seq) > beforeExpiry),
    ).toBe(false);
    for (const path of ["/api/context", "/sync/bootstrap?clientId=expired", documentPath])
      expect((await second.fetch(path)).status).toBe(401);
    expect((await runtime.nativeConnect("expired-owner", second.cookieHeader())).status).not.toBe(101);
  } finally {
    await runtime.close();
  }
}, 30000);

it("reports missing email configuration uniformly before checking recipient eligibility", async () => {
  const runtime = await startEmailRuntime({ resendApiKey: "" });
  const browser = nativeAgent(runtime);
  try {
    const known = await browser.requestLink(runtime.ownerEmail),
      unknown = await browser.requestLink("unknown@datafog.ai");
    expect(known.status).toBe(503);
    expect(unknown.status).toBe(503);
    expect(await known.json()).toEqual(await unknown.json());
    expect(await runtime.capturedEmails()).toHaveLength(0);
    expect((await runtime.authRows()).links).toHaveLength(0);
  } finally {
    await runtime.close();
  }
}, 30000);

it("restores workspace data without reviving archived native sessions or sign-in links", async () => {
  const source = await startEmailRuntime({ backups: true });
  const target = await startEmailRuntime({ backups: true, isolatedRestore: true });
  const owner = nativeAgent(source),
    pending = nativeAgent(source);
  try {
    await signIn(source, owner, source.ownerEmail);
    const original = (await (await owner.fetch("/api/context")).json()) as WorkspaceContext;
    const initial = (await (
      await owner.fetch("/sync/bootstrap?clientId=backup-native-owner")
    ).json()) as BootstrapResponse;
    await expect
      .poll(async () => (await source.backupKeys()).some((key) => key.endsWith("/manifest.json")), { timeout: 30000 })
      .toBe(true);
    await expect
      .poll(
        async () =>
          (await source.backupTables())["scheduled_job"]?.some(
            (job) => typeof job["payload"] === "string" && Boolean(JSON.parse(job["payload"]).manifestKey),
          ),
        { timeout: 30000 },
      )
      .toBe(true);
    const issueId = uuidv7();
    expect(
      await (
        await owner.json("/sync/push", {
          clientId: "native-backup-write",
          mutations: [
            {
              id: 1,
              name: "issueCreate",
              ts: new Date().toISOString(),
              args: {
                id: issueId,
                teamId: initial.rows.team![0]!.id,
                title: "Recovered native workspace",
                subscriptionId: uuidv7(),
              },
            },
          ],
        })
      ).json(),
    ).toMatchObject({ ok: true, rejected: [] });
    const invitationResponse = await owner.json("/api/invitations", { email: "pending@datafog.ai" });
    expect(invitationResponse.status).toBe(200);
    const invitation = (await invitationResponse.json()) as { invitation: { id: string } };
    expect((await pending.requestLink(source.ownerEmail)).status).toBe(202);
    const pendingToken = linkToken(emailLink((await source.capturedEmails()).at(-1)!));
    const sourceAuth = await source.authRows();
    expect(sourceAuth.sessions).toHaveLength(1);
    expect(sourceAuth.links.some((link) => link.consumed_at === null)).toBe(true);
    expect(sourceAuth.links.some((link) => link.consumed_at !== null)).toBe(true);
    const receipt = await source.backup();
    const archive = await source.exportBackup(receipt.key);
    const directory = archive.find((object) => object.key.endsWith("/directory.json"))!.data;
    expect(directory).toContain(hash(owner.cookies.get(SESSION_COOKIE)!));
    expect(directory).toContain(hash(pendingToken));
    await target.importBackup(archive);
    expect((await target.restoreBackup(receipt.key)).key).toBe(receipt.key);
    const restoredAuth = await target.authRows();
    expect(restoredAuth.sessions).toHaveLength(0);
    expect(restoredAuth.links).toHaveLength(0);
    expect(restoredAuth.accounts).toEqual(sourceAuth.accounts);
    expect(restoredAuth.identities).toEqual(sourceAuth.identities);
    expect(restoredAuth.members).toEqual(sourceAuth.members);
    const stale = nativeAgent(target);
    stale.cookies.set(SESSION_COOKIE, owner.cookies.get(SESSION_COOKIE)!);
    stale.cookies.set(LOGIN_COOKIE, pending.cookies.get(LOGIN_COOKIE)!);
    expect((await stale.fetch("/api/context")).status).toBe(401);
    expect((await stale.inspect(pendingToken)).status).toBe(401);
    expect((await stale.consume(pendingToken)).status).toBe(401);
    const fresh = nativeAgent(target);
    await signIn(target, fresh, target.ownerEmail);
    const context = (await (await fresh.fetch("/api/context")).json()) as WorkspaceContext;
    expect(context).toMatchObject({
      workspaceId: original.workspaceId,
      actor: original.actor,
      role: original.role,
      admissionId: original.admissionId,
    });
    const restored = (await (
      await fresh.fetch("/sync/bootstrap?clientId=restored-native-owner")
    ).json()) as BootstrapResponse;
    expect(restored.rows.issue).toContainEqual(
      expect.objectContaining({ id: issueId, title: "Recovered native workspace" }),
    );
    const membership = await fresh.fetch("/api/members");
    expect(membership.status).toBe(200);
    expect(await membership.json()).toMatchObject({
      invitations: expect.arrayContaining([
        expect.objectContaining({ id: invitation.invitation.id, email: "pending@datafog.ai" }),
      ]),
    });
  } finally {
    await Promise.allSettled([source.close(), target.close()]);
  }
}, 30000);
