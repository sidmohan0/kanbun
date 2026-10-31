import { describe, expect, it } from "vitest";
import type { Row } from "@kanbun/model";
import { eventSchema } from "@kanbun/events";
import {
  checksStatus,
  githubAuthorizationUrl,
  githubConnection,
  githubActivityVisible,
  githubInstallationUrl,
  pullRequestLocation,
  reviewStatus,
} from "./github";

describe("GitHub source context", () => {
  it("only navigates to the intended GitHub integration destinations", () => {
    expect(
      githubAuthorizationUrl("https://github.com/login/oauth/authorize?client_id=public&state=proof"),
    ).toBeTruthy();
    expect(githubInstallationUrl("https://github.com/apps/kanbun-context/installations/new")).toBeTruthy();
    for (const value of [
      "https://elsewhere.example/login/oauth/authorize",
      "javascript:alert(1)",
      "https://github.com@elsewhere.example/login/oauth/authorize",
      "https://user:secret@github.com/login/oauth/authorize",
      "http://github.com/login/oauth/authorize",
      "https://github.com/another/path",
    ]) {
      expect(githubAuthorizationUrl(value)).toBeNull();
      expect(githubInstallationUrl(value)).toBeNull();
    }
  });
  it("identifies canonical pull requests without forwarding query data", () => {
    expect(pullRequestLocation("https://github.com/acme/service/pull/42?diff=split#discussion")).toEqual({
      owner: "acme",
      name: "service",
      number: 42,
      url: "https://github.com/acme/service/pull/42",
    });
    for (const value of [
      "https://elsewhere.example/acme/service/pull/42",
      "https://github.com/acme/service/issues/42",
      "https://github.com/acme/service/pull/42/files",
      "https://github.com/acme/service/pull/0",
    ])
      expect(pullRequestLocation(value)).toBeNull();
  });
  it("never reuses green checks or approval from an older commit", () => {
    const pr = {
      headSha: "current",
      checksHeadSha: "previous",
      reviewHeadSha: "previous",
      checksStatus: "passing",
      reviewStatus: "approved",
    } as Row<"issuePullRequest">;
    expect(checksStatus(pr)).toBe("unknown");
    expect(reviewStatus(pr)).toBe("unknown");
    expect(checksStatus({ ...pr, checksHeadSha: "current" })).toBe("passing");
    expect(reviewStatus({ ...pr, reviewHeadSha: "current" })).toBe("approved");
  });
  it("validates the owner catalog instead of treating malformed configuration as connected", () => {
    const source = {
      installationId: 2,
      repositoryId: 3,
      owner: "acme",
      name: "service",
      private: true,
      url: "https://github.com/acme/service",
    };
    expect(
      githubConnection({
        configured: true,
        appName: "Kanbun",
        authorizationRequired: false,
        repositories: [{ ...source, id: "binding", teamId: "engineering" }],
        catalog: [source],
      }).catalog,
    ).toHaveLength(1);
    expect(() =>
      githubConnection({
        configured: true,
        appName: "Kanbun",
        authorizationRequired: false,
        repositories: [],
        catalog: [{ ...source, repositoryId: "forged" }],
      }),
    ).toThrow();
  });
  it("redacts already-loaded GitHub facts when the issue or repository scope changes", () => {
    const issue = { id: "issue", teamId: "team", createdSeq: 10, createdAt: "2026-10-30T00:00:00Z" } as Row<"issue">;
    const binding = { id: "binding", teamId: "team", archivedAt: null } as Row<"githubRepository">;
    const event = eventSchema.parse({
      type: "GitHubPullRequestUnlinked",
      entityType: "issue",
      entityId: "issue",
      teamId: "team",
      scopeUserId: null,
      payload: { id: "link", repositoryBindingId: "binding", issueIncarnation: "seq:10" },
      seq: 11,
      eventIndex: 0,
      branchId: "main",
      txnId: "txn",
      actor: { id: "person", type: "user" },
      clientId: null,
      mutationId: null,
      sessionId: null,
      sourceRef: null,
      causationSeq: null,
      reason: null,
      ts: 1,
    });
    expect(githubActivityVisible(event, issue, [binding])).toBe(true);
    expect(githubActivityVisible(event, issue, [])).toBe(false);
    expect(githubActivityVisible(event, { ...issue, teamId: "other-team" }, [binding])).toBe(false);
    expect(githubActivityVisible(event, { ...issue, createdSeq: 12 }, [binding])).toBe(false);
    expect(githubActivityVisible(event, issue, [{ ...binding, archivedAt: "2026-10-31T00:00:00Z" }])).toBe(false);
  });
});
