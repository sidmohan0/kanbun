import { expect, it } from "vitest";
import { modelNames, type ModelName } from "@kanbun/model";
import type { GitHubPullRequestSnapshot } from "@kanbun/events";
import { MemoryStore, issueIncarnation, type Store } from "@kanbun/sync";
import { SyncServer } from "@kanbun/sync/server";
import { openWorkspaceDb } from "@kanbun/sync/server/node";
import { applyGitHubEvent, githubIssueIdentifiers, mutators, tools } from "../src";

const id = (n: number) => `019a0000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const person = { id: "owner", type: "user" } as const;
const time = "2026-10-30T00:00:00.000Z";
const source = {
  installationId: 12,
  repositoryId: 34,
  owner: "example",
  name: "project",
  url: "https://github.com/example/project",
  private: true,
};
const snapshot: GitHubPullRequestSnapshot = {
  number: 9,
  title: "Ship the change",
  url: `${source.url}/pull/9`,
  state: "open",
  headRef: "feature/change",
  baseRef: "main",
  headSha: "b".repeat(40),
  reviewStatus: "approved",
  reviewHeadSha: "a".repeat(40),
  reviewers: [{ login: "reviewer", state: "approved" }],
  previewLinks: [],
  checksStatus: "passing",
  checksHeadSha: "a".repeat(40),
  checksUrl: `${source.url}/pull/9/checks`,
  providerUpdatedAt: time,
  observedAt: time,
};
function fixture() {
  const { db, driver } = openWorkspaceDb();
  const server = new SyncServer({ driver, mutators, now: () => time });
  server.system("workspaceInit", {
    organization: { id: id(1), name: "Example", urlKey: "example" },
    owner: { id: person.id, name: "Owner", email: "owner@example.com" },
  });
  expect(
    server.push(person, {
      clientId: "seed",
      mutations: [
        {
          id: 1,
          name: "teamCreate",
          ts: time,
          args: {
            id: id(2),
            name: "Engineering",
            key: "ENG",
            membershipId: id(8),
            stateIds: { backlog: id(3), todo: id(4), inProgress: id(5), done: id(6), canceled: id(7) },
          },
        },
        {
          id: 2,
          name: "issueCreate",
          ts: time,
          args: { id: id(9), teamId: id(2), title: "A human task", subscriptionId: id(10) },
        },
        { id: 3, name: "issueAssertStatus", ts: time, args: { id: id(9), stateId: id(5) } },
      ],
    }),
  ).toMatchObject({ ok: true, rejected: [] });
  return { db, driver, server };
}
const rows = (store: Store, model: ModelName) => store.list(model).sort((a, b) => a.id.localeCompare(b.id));

it("replays GitHub facts identically in memory and SQLite, attributes observations, and preserves human issue state", () => {
  const actual = fixture(),
    replay = fixture();
  try {
    const memory = new MemoryStore();
    for (const model of modelNames) for (const row of actual.server.store.list(model)) memory.insert(model, row);
    const before = structuredClone(actual.server.store.get("issue", id(9))!);
    const args = {
      id: id(12),
      issueId: id(9),
      issueIncarnation: issueIncarnation(before),
      repositoryBindingId: id(11),
      revision: 1,
      snapshot,
    };
    actual.server.github("githubRepositoryConfigure", { id: id(11), teamId: id(2), source }, person);
    actual.server.github("githubPullRequestLink", args, person, snapshot.url);
    expect(actual.server.store.get("issuePullRequest", id(12))).toMatchObject({
      reviewStatus: "unknown",
      reviewers: [],
      checksStatus: "unknown",
    });
    const merged = {
      ...snapshot,
      state: "merged" as const,
      reviewHeadSha: snapshot.headSha,
      checksHeadSha: snapshot.headSha,
    };
    actual.server.github(
      "githubPullRequestObserve",
      { ...args, revision: 2, snapshot: merged },
      { id: `github:${id(11)}`, type: "integration" },
      snapshot.url,
    );
    const seq = actual.server.currentSeq();
    actual.server.github(
      "githubPullRequestObserve",
      args,
      { id: `github:${id(11)}`, type: "integration" },
      snapshot.url,
    );
    expect(actual.server.currentSeq()).toBe(seq);
    expect(actual.server.store.get("issue", id(9))).toEqual(before);
    const facts = actual.server
      .events(person)
      .filter((event) => event.type.startsWith("GitHub") || event.type === "ObservedGitHubPullRequest");
    expect(facts).toHaveLength(4);
    for (const event of facts.filter((event) => event.type === "ObservedGitHubPullRequest"))
      expect(event).toMatchObject({ actor: { id: `github:${id(11)}`, type: "integration" }, sourceRef: snapshot.url });
    expect(facts.find((event) => event.type === "GitHubPullRequestLinked")!.actor).toEqual(person);
    for (const event of facts)
      for (const store of [memory, replay.server.store])
        applyGitHubEvent(
          { store, actor: event.actor, actorId: event.actor.id, server: false, now: "2000-01-01T00:00:00.000Z" },
          event,
        );
    for (const model of ["githubRepository", "issuePullRequest"] as const) {
      expect(rows(memory, model)).toEqual(rows(actual.server.store, model));
      expect(rows(replay.server.store, model)).toEqual(rows(actual.server.store, model));
    }
  } finally {
    actual.db.close();
    replay.db.close();
  }
});

it("rejects forged provider mutations through the normal user sync path", () => {
  const { db, server } = fixture();
  try {
    const result = server.push(person, {
      clientId: "forged-provider",
      mutations: [{ id: 1, name: "githubRepositoryConfigure", ts: time, args: { id: id(11), teamId: id(2), source } }],
    });
    expect(result).toMatchObject({ ok: true, rejected: [{ id: 1, error: "Verified GitHub App authority required" }] });
    expect(server.store.list("githubRepository")).toHaveLength(0);
    expect(tools().map((tool) => tool.name)).not.toContain("githubRepositoryConfigure");
  } finally {
    db.close();
  }
});

it("finds identifier tokens across configurable branch separators without partial word/number matches", () => {
  expect([...githubIssueIdentifiers({ headRef: "sid/eng-1_fix_ENG-2", title: "[ENG-2] and ENG-3." })].sort()).toEqual([
    "ENG-1",
    "ENG-2",
    "ENG-3",
  ]);
  const found = githubIssueIdentifiers({
    headRef: "feature/xENG-1/ENG-2abc/ENG-03",
    title: "éENG-4 ENG-5修 ENG-9007199254740993 OTHER-6",
  });
  expect([...found]).toEqual(["XENG-1", "OTHER-6"]);
});

it("permits automatic links only through the mapped integration authority, including private teams", () => {
  const { db, server } = fixture();
  try {
    expect(
      server.push(person, {
        clientId: "private-team",
        mutations: [{ id: 1, name: "teamUpdate", ts: time, args: { id: id(2), patch: { visibility: "private" } } }],
      }),
    ).toMatchObject({ rejected: [] });
    server.github("githubRepositoryConfigure", { id: id(11), teamId: id(2), source }, person);
    const issue = server.store.get("issue", id(9))!;
    const args = {
      id: id(12),
      issueId: issue.id,
      issueIncarnation: issueIncarnation(issue),
      repositoryBindingId: id(11),
      revision: 1,
      snapshot: { ...snapshot, headRef: "owner/eng-1_fix", title: "Ship ENG-1" },
    };
    expect(
      server.push(person, {
        clientId: "forged-auto-link",
        mutations: [{ id: 1, name: "githubPullRequestAutoLink", args, ts: time }],
      }),
    ).toMatchObject({ rejected: [{ error: "Verified GitHub App authority required" }] });
    expect(() => server.github("githubPullRequestAutoLink", args, person)).toThrow("GitHub observer required");
    expect(() => server.github("githubPullRequestAutoLink", args, { id: "github:other", type: "integration" })).toThrow(
      "GitHub observer required",
    );
    const integration = { id: `github:${id(11)}`, type: "integration" } as const;
    server.github(
      "githubPullRequestAutoLink",
      { ...args, snapshot: { ...args.snapshot, headRef: "ENG-12_fix", title: "OTHER-1" } },
      integration,
    );
    expect(server.store.list("issuePullRequest")).toHaveLength(0);
    server.github("githubPullRequestAutoLink", args, integration, args.snapshot.url);
    expect(server.store.get("issuePullRequest", id(12))).toMatchObject({
      issueId: issue.id,
      teamId: id(2),
      title: "Ship ENG-1",
    });
    expect(server.store.get("issue", issue.id)).toEqual(issue);
    const after = server.currentSeq();
    server.github(
      "githubPullRequestAutoLink",
      { ...args, id: id(13), revision: 2, snapshot: { ...args.snapshot, title: "New ENG-1" } },
      integration,
    );
    expect(server.currentSeq()).toBe(after);
    expect(
      server
        .events(person)
        .filter((e) => e.type === "GitHubPullRequestLinked")
        .at(-1),
    ).toMatchObject({ actor: integration });
    expect(tools().map((tool) => tool.name)).not.toContain("githubPullRequestAutoLink");
  } finally {
    db.close();
  }
});
