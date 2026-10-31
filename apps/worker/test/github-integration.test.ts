import { expect, it } from "vitest";
import { issueIncarnation, type BootstrapResponse } from "@kanbun/sync";
import { uuidv7, type Row } from "@kanbun/model";
import { emailLink, linkToken, nativeAgent } from "./email-runtime";
import {
  startGithubRuntime,
  githubResponses,
  githubPullRequest,
  githubSignature,
  GITHUB_INSTALLATION_ID,
  GITHUB_REPOSITORY_ID,
} from "./github-runtime";

type Runtime = Awaited<ReturnType<typeof startGithubRuntime>>;
type Agent = ReturnType<typeof nativeAgent>;
async function signIn(runtime: Runtime, agent: Agent, email = runtime.ownerEmail, admitted = true) {
  expect((await agent.requestLink(email)).status).toBe(202);
  const token = linkToken(emailLink((await runtime.capturedEmails()).at(-1)!));
  expect((await agent.consume(token)).status).toBe(200);
  if (admitted) expect((await agent.fetch("/api/context")).status).toBe(200);
}
async function connect(agent: Agent) {
  const response = await agent.json("/api/integrations/github/connect", {});
  expect(response.status).toBe(200);
  const result = (await response.json()) as { url: string };
  const url = new URL(result.url);
  expect(url.origin).toBe("https://github.com");
  expect(url.pathname).toBe("/login/oauth/authorize");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  return { response, url, state: url.searchParams.get("state")! };
}
const callback = (agent: Agent, state: string) =>
  agent.fetch(`/api/integrations/github/callback?code=fixture-code&state=${encodeURIComponent(state)}`, {
    redirect: "manual",
  });

it("keeps GitHub OAuth tied to the native owner session and binds only the user-granted installation catalog", async () => {
  const runtime = await startGithubRuntime();
  try {
    const owner = nativeAgent(runtime),
      otherSession = nativeAgent(runtime),
      anonymous = nativeAgent(runtime);
    expect((await anonymous.fetch("/api/integrations/github")).status).toBe(401);
    await signIn(runtime, owner);
    await signIn(runtime, otherSession);
    const authorization = await connect(owner);
    const cookie = authorization.response.headers
      .getSetCookie()
      .find((value) => value.startsWith("__Host-kanbun-github="))!;
    for (const flag of ["Secure", "HttpOnly", "SameSite=Lax", "Path=/"]) expect(cookie).toContain(flag);
    otherSession.cookies.set("__Host-kanbun-github", owner.cookies.get("__Host-kanbun-github")!);
    expect((await callback(otherSession, authorization.state)).status).toBeGreaterThanOrEqual(400);
    expect((await runtime.githubRequests()).length).toBe(0);
    expect((await callback(owner, authorization.state)).status).toBe(303);
    expect((await callback(owner, authorization.state)).status).toBeGreaterThanOrEqual(400);
    const status = await owner.fetch("/api/integrations/github");
    expect(status.status).toBe(200);
    const body = await status.text();
    expect(body).toContain("example/pilot");
    expect(body).not.toContain("fixture-user-oauth-token");
    expect(body).not.toContain("fixture-app-client-secret");
    expect(body).not.toContain("PRIVATE KEY");
    const bootstrap = (await (await owner.fetch("/sync/bootstrap?clientId=github-owner")).json()) as BootstrapResponse;
    const teamId = String(bootstrap.rows.team![0]!.id);
    const forged = await owner.json("/sync/push", {
      clientId: "github-untrusted-command",
      mutations: [
        {
          id: 1,
          name: "githubRepositoryConfigure",
          ts: new Date().toISOString(),
          args: {
            id: uuidv7(),
            teamId,
            source: {
              installationId: GITHUB_INSTALLATION_ID,
              repositoryId: GITHUB_REPOSITORY_ID,
              owner: "example",
              name: "pilot",
              url: "https://github.com/example/pilot",
              private: true,
            },
          },
        },
      ],
    });
    expect(await forged.json()).toMatchObject({ rejected: [{}] });
    for (const foreign of [
      { teamId, installationId: 999, repositoryId: GITHUB_REPOSITORY_ID },
      { teamId, installationId: GITHUB_INSTALLATION_ID, repositoryId: 999 },
    ]) {
      expect((await owner.json("/api/integrations/github/repositories", foreign)).status).toBeGreaterThanOrEqual(400);
    }
    const configured = await owner.json("/api/integrations/github/repositories", {
      teamId,
      installationId: GITHUB_INSTALLATION_ID,
      repositoryId: GITHUB_REPOSITORY_ID,
    });
    expect(configured.status).toBe(200);
    const bound = (await (await owner.fetch("/sync/bootstrap?clientId=github-bound")).json()) as BootstrapResponse;
    expect(bound.rows.githubRepository).toHaveLength(1);
    expect(bound.rows.githubRepository![0]).toMatchObject({ teamId, repositoryId: GITHUB_REPOSITORY_ID });
    const providerRequests = await runtime.githubRequests();
    expect(providerRequests.filter((request) => request.url.includes("/login/oauth/access_token"))).toHaveLength(1);
    expect(providerRequests.some((request) => request.url.includes("/app/installations/999/"))).toBe(false);
  } finally {
    await runtime.close();
  }
}, 30000);

it("accepts only signed webhook facts and fetches canonical PR context once per delivery without trusting stale payloads", async () => {
  const runtime = await startGithubRuntime();
  try {
    const owner = nativeAgent(runtime);
    await signIn(runtime, owner);
    expect((await callback(owner, (await connect(owner)).state)).status).toBe(303);
    const bootstrap = async () =>
      (await (await owner.fetch("/sync/bootstrap?clientId=github-reader")).json()) as BootstrapResponse;
    const teamId = String((await bootstrap()).rows.team![0]!.id);
    expect(
      (
        await owner.json("/api/integrations/github/repositories", {
          teamId,
          installationId: GITHUB_INSTALLATION_ID,
          repositoryId: GITHUB_REPOSITORY_ID,
        })
      ).status,
    ).toBe(200);
    const repositoryBindingId = String((await bootstrap()).rows.githubRepository![0]!.id);
    const issueId = uuidv7();
    const created = await owner.json("/sync/push", {
      clientId: "github-issue-writer",
      mutations: [
        {
          id: 1,
          name: "issueCreate",
          ts: new Date().toISOString(),
          args: { id: issueId, teamId, title: "Prepare pilot", subscriptionId: uuidv7() },
        },
      ],
    });
    expect(await created.json()).toMatchObject({ ok: true, rejected: [] });
    const issue = (await bootstrap()).rows.issue!.find((row) => row.id === issueId)!;
    const linked = await owner.json("/api/integrations/github/pull-requests/link", {
      issueId,
      issueIncarnation: issueIncarnation(issue as Row<"issue">),
      repositoryBindingId,
      url: "https://github.com/example/pilot/pull/42",
    });
    expect(linked.status).toBe(200);
    const initial = (await bootstrap()).rows.issuePullRequest![0]!;
    expect(initial).toMatchObject({ title: "Ship the pilot", state: "open" });
    const forcePushed = githubPullRequest({
      head: { ref: "feature/pilot", sha: "b".repeat(40) },
      updated_at: "2026-10-30T10:30:00Z",
    });
    const forcePushResponses = githubResponses(forcePushed).map((response) =>
      response.path.includes("/reviews?")
        ? { ...response, body: [{ id: 1, state: "APPROVED", commit_id: "a".repeat(40), user: { id: 301 } }] }
        : response.path.includes("/check-runs?")
          ? {
              ...response,
              body: {
                total_count: 1,
                check_runs: [{ status: "completed", conclusion: "success", head_sha: "a".repeat(40) }],
              },
            }
          : response.path.includes("/status?")
            ? { ...response, body: { total_count: 0, statuses: [] } }
            : response,
    );
    await runtime.setGithubResponses(forcePushResponses);
    expect((await owner.json("/api/integrations/github/pull-requests/refresh", { linkId: initial.id })).status).toBe(
      200,
    );
    expect((await bootstrap()).rows.issuePullRequest![0]).toMatchObject({
      headSha: "b".repeat(40),
      checksStatus: "unknown",
      reviewStatus: "pending",
    });
    const mergedPR = githubPullRequest({
      state: "closed",
      merged: true,
      merged_at: "2026-10-30T11:00:00Z",
      updated_at: "2026-10-30T11:00:00Z",
    });
    const requestsBeforeRace = (await runtime.githubRequests()).filter(
      (request) => new URL(request.url).pathname === "/repos/example/pilot/pulls/42",
    ).length;
    await runtime.setGithubResponses([
      {
        method: "GET",
        path: "/repos/example/pilot/pulls/42",
        body: githubPullRequest(),
        once: true,
        gate: "older-refresh",
      },
      ...githubResponses(mergedPR),
    ]);
    const slowRefresh = owner.json("/api/integrations/github/pull-requests/refresh", { linkId: initial.id });
    try {
      await expect
        .poll(
          async () =>
            (await runtime.githubRequests()).filter(
              (request) => new URL(request.url).pathname === "/repos/example/pilot/pulls/42",
            ).length,
        )
        .toBe(requestsBeforeRace + 1);
      expect((await owner.json("/api/integrations/github/pull-requests/refresh", { linkId: initial.id })).status).toBe(
        200,
      );
      expect((await bootstrap()).rows.issuePullRequest![0]!.state).toBe("merged");
    } finally {
      // The older request's own head revalidation is consistent with its captured snapshot;
      // only the DO's fetch reservation can prevent this late response replacing the newer one.
      await runtime.setGithubResponses(githubResponses());
      await runtime.releaseGithubResponse("older-refresh");
      expect((await slowRefresh).status).toBe(200);
    }
    expect((await bootstrap()).rows.issuePullRequest![0]!.state).toBe("merged");
    const beforeInvalidSignatures = (await bootstrap()).rows.issuePullRequest;
    const payload = JSON.stringify({
      action: "closed",
      installation: { id: GITHUB_INSTALLATION_ID },
      repository: { id: GITHUB_REPOSITORY_ID },
      number: 42,
      pull_request: { number: 42, title: "Untrusted webhook title", merged: true },
    });
    const deliver = (body: string, deliveryId: string, signature = githubSignature(body)) =>
      runtime.fetch(
        "/api/integrations/github/webhook",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-GitHub-Event": "pull_request",
            "X-GitHub-Delivery": deliveryId,
            "X-Hub-Signature-256": signature,
          },
          body,
        },
        null,
      );
    const before = (await runtime.githubRequests()).length;
    for (const signature of ["", "sha256=" + "0".repeat(64), githubSignature(payload + " ")]) {
      expect((await deliver(payload, uuidv7(), signature)).status).toBeGreaterThanOrEqual(400);
    }
    expect((await runtime.githubRequests()).length).toBe(before);
    expect((await bootstrap()).rows.issuePullRequest).toEqual(beforeInvalidSignatures);
    for (const foreign of [
      { installation: { id: 999 }, repository: { id: GITHUB_REPOSITORY_ID } },
      { installation: { id: GITHUB_INSTALLATION_ID }, repository: { id: 999 } },
    ]) {
      const body = JSON.stringify({ action: "opened", number: 42, pull_request: { number: 42 }, ...foreign });
      expect((await deliver(body, uuidv7())).ok).toBe(true);
    }
    await runtime.setGithubResponses(
      githubResponses(
        githubPullRequest({
          state: "closed",
          merged: true,
          merged_at: "2026-10-30T11:00:00Z",
          updated_at: "2026-10-30T11:00:00Z",
        }),
      ),
    );
    const mergedDelivery = uuidv7();
    const beforeDeliveryRevision = Number((await bootstrap()).rows.issuePullRequest![0]!.observationRevision);
    expect((await deliver(payload, mergedDelivery)).ok).toBe(true);
    await expect
      .poll(async () => Number((await bootstrap()).rows.issuePullRequest![0]!.observationRevision), { timeout: 15000 })
      .toBeGreaterThan(beforeDeliveryRevision);
    const merged = (await bootstrap()).rows.issuePullRequest![0]!;
    expect(merged.title).toBe("Ship the pilot");
    const after = (await runtime.githubRequests()).length;
    const prReadsBeforeReplay = (await runtime.githubRequests()).filter(
      (request) => new URL(request.url).pathname === "/repos/example/pilot/pulls/42",
    ).length;
    expect((await deliver(payload, mergedDelivery)).ok).toBe(true);
    // A fresh old webhook is still resolved through GitHub's current canonical state.
    const oldPayload = JSON.stringify({
      action: "opened",
      installation: { id: GITHUB_INSTALLATION_ID },
      repository: { id: GITHUB_REPOSITORY_ID },
      number: 42,
      pull_request: { number: 42, title: "Old open title", state: "open" },
    });
    expect((await deliver(oldPayload, uuidv7())).ok).toBe(true);
    await expect.poll(async () => (await runtime.githubRequests()).length, { timeout: 15000 }).toBeGreaterThan(after);
    await expect
      .poll(async () => Number((await bootstrap()).rows.issuePullRequest![0]!.observationRevision), { timeout: 15000 })
      .toBeGreaterThan(Number(merged.observationRevision));
    expect(
      (await runtime.githubRequests()).filter(
        (request) => new URL(request.url).pathname === "/repos/example/pilot/pulls/42",
      ).length,
    ).toBe(prReadsBeforeReplay + 2);
    expect((await bootstrap()).rows.issuePullRequest![0]).toMatchObject({ title: "Ship the pilot", state: "merged" });
    const events = await owner.fetch(`/sync/events?issueId=${issueId}`);
    const history = await events.text();
    expect(history).toContain("ObservedGitHubPullRequest");
    expect(history).not.toContain("Untrusted webhook title");
    expect(history).not.toContain("Old open title");
    expect((await runtime.githubRequests()).some((request) => request.url.includes("/installations/999/"))).toBe(false);
    const installationRequests = (await runtime.githubRequests()).filter((request) =>
      request.url.endsWith("/access_tokens"),
    );
    expect(installationRequests.length).toBeGreaterThan(0);
    for (const request of installationRequests) {
      expect(JSON.parse(request.body)).toEqual({
        repository_ids: [GITHUB_REPOSITORY_ID],
        permissions: { pull_requests: "read", checks: "read", statuses: "read" },
      });
    }
    const beforeUnlinkFetch = (await runtime.githubRequests()).filter(
      (request) => new URL(request.url).pathname === "/repos/example/pilot/pulls/42",
    ).length;
    await runtime.setGithubResponses([
      { method: "GET", path: "/repos/example/pilot/pulls/42", body: mergedPR, once: true, gate: "unlink-refresh" },
      ...githubResponses(mergedPR),
    ]);
    const pendingRefresh = owner.json("/api/integrations/github/pull-requests/refresh", { linkId: initial.id });
    try {
      await expect
        .poll(
          async () =>
            (await runtime.githubRequests()).filter(
              (request) => new URL(request.url).pathname === "/repos/example/pilot/pulls/42",
            ).length,
        )
        .toBe(beforeUnlinkFetch + 1);
      const unlinked = await owner.json("/sync/push", {
        clientId: "github-unlink-writer",
        mutations: [{ id: 1, name: "issuePullRequestUnlink", args: { id: initial.id }, ts: new Date().toISOString() }],
      });
      expect(await unlinked.json()).toMatchObject({ ok: true, rejected: [] });
      expect((await bootstrap()).rows.issuePullRequest).toHaveLength(0);
    } finally {
      await runtime.releaseGithubResponse("unlink-refresh");
      expect((await pendingRefresh).status).toBe(409);
    }
    expect((await bootstrap()).rows.issuePullRequest).toHaveLength(0);
    expect((await bootstrap()).rows.issue!.find((row) => row.id === issueId)!.stateId).toBe(issue.stateId);
  } finally {
    await runtime.close();
  }
}, 45000);

it("keeps mapped private-team repositories and PR history hidden when an issue moves into a public team", async () => {
  const runtime = await startGithubRuntime();
  try {
    const owner = nativeAgent(runtime),
      member = nativeAgent(runtime);
    await signIn(runtime, owner);
    const invitation = (await (await owner.json("/api/invitations", { email: "member@datafog.ai" })).json()) as {
      token: string;
    };
    await signIn(runtime, member, "member@datafog.ai", false);
    expect((await member.json("/api/invitations/accept", { token: invitation.token })).status).toBe(200);
    expect((await member.fetch("/api/integrations/github")).status).toBe(403);
    expect((await member.json("/api/integrations/github/connect", {})).status).toBe(403);
    expect((await callback(owner, (await connect(owner)).state)).status).toBe(303);
    const bootstrap = async (agent: Agent) =>
      (await (
        await agent.fetch(`/sync/bootstrap?clientId=github-privacy-${agent === owner ? "owner" : "member"}`)
      ).json()) as BootstrapResponse;
    const publicTeam = String((await bootstrap(owner)).rows.team![0]!.id),
      privateTeam = uuidv7(),
      issueId = uuidv7();
    let mutationId = 0;
    async function push(name: string, args: unknown) {
      const response = await owner.json("/sync/push", {
        clientId: "github-private-writer",
        mutations: [{ id: ++mutationId, name, args, ts: new Date().toISOString() }],
      });
      expect(await response.json()).toMatchObject({ ok: true, rejected: [] });
    }
    await push("teamCreate", {
      id: privateTeam,
      name: "Private planning",
      key: "PRIV",
      visibility: "private",
      membershipId: uuidv7(),
      stateIds: { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() },
    });
    await push("issueCreate", {
      id: issueId,
      teamId: privateTeam,
      title: "Private pilot task",
      subscriptionId: uuidv7(),
    });
    expect(
      (
        await owner.json("/api/integrations/github/repositories", {
          teamId: privateTeam,
          installationId: GITHUB_INSTALLATION_ID,
          repositoryId: GITHUB_REPOSITORY_ID,
        })
      ).status,
    ).toBe(200);
    const bindingId = String((await bootstrap(owner)).rows.githubRepository![0]!.id);
    const issue = (await bootstrap(owner)).rows.issue!.find((row) => row.id === issueId)!;
    expect(
      (
        await owner.json("/api/integrations/github/pull-requests/link", {
          issueId,
          issueIncarnation: issueIncarnation(issue as Row<"issue">),
          repositoryBindingId: bindingId,
          url: "https://github.com/example/pilot/pull/42",
        })
      ).status,
    ).toBe(200);
    const hidden = await bootstrap(member);
    expect(hidden.rows.githubRepository).toHaveLength(0);
    expect(hidden.rows.issuePullRequest).toHaveLength(0);
    expect(JSON.stringify(hidden)).not.toContain("example/pilot");
    const forbiddenLink = await member.json("/api/integrations/github/pull-requests/link", {
      issueId,
      issueIncarnation: issueIncarnation(issue as Row<"issue">),
      repositoryBindingId: bindingId,
      url: "https://github.com/example/pilot/pull/42",
    });
    expect(forbiddenLink.status).toBe(403);
    const forbiddenBody = await forbiddenLink.text();
    expect(forbiddenBody).not.toContain("Ship the pilot");
    expect(forbiddenBody).not.toContain("example/pilot");
    await push("issueUpdate", { id: issueId, patch: { teamId: publicTeam, title: "Public pilot task" } });
    const visible = await bootstrap(member);
    expect(visible.rows.issue!.find((row) => row.id === issueId)).toMatchObject({ title: "Public pilot task" });
    expect(visible.rows.issuePullRequest).toHaveLength(0);
    for (const endpoint of [
      "/sync/events",
      `/sync/events?issueId=${issueId}`,
      "/sync/activity",
      `/sync/pull?clientId=github-privacy-member&since=${hidden.seq}`,
    ]) {
      const response = await member.fetch(endpoint);
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).not.toContain("Ship the pilot");
      expect(body).not.toContain("example/pilot");
      expect(body).not.toContain(bindingId);
    }
    expect((await owner.json("/api/integrations/github/repositories/disconnect", { bindingId })).status).toBe(200);
    const disconnected = await bootstrap(owner);
    expect(disconnected.rows.githubRepository).toHaveLength(0);
    expect(disconnected.rows.issuePullRequest).toHaveLength(0);
    const history = await (await owner.fetch(`/sync/events?issueId=${issueId}`)).text();
    expect(history).not.toContain("Ship the pilot");
    expect(history).not.toContain("example/pilot");
  } finally {
    await runtime.close();
  }
}, 30000);
