import { expect, it } from "vitest";
import { uuidv7 } from "@kanbun/model";
import type { GitHubPullRequestSnapshot } from "@kanbun/events";
import { mutators } from "@kanbun/mutators";
import { issueIncarnation } from "@kanbun/sync";
import { SyncServer } from "@kanbun/sync/server";
import { openWorkspaceDb } from "@kanbun/sync/server/node";
import { consumeGitHubJob, GITHUB_JOB, queueGitHubDelivery, reserveGitHubRevision } from "../src/github-observer";

const owner = { id: "owner", type: "user" } as const;
const time = "2026-11-01T12:00:00.000Z";
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
  title: "Ship ENG-1",
  headRef: "owner/eng-1_fix",
  url: `${source.url}/pull/9`,
  state: "open",
  headSha: "a".repeat(40),
  baseRef: "main",
  reviewStatus: "pending",
  reviewHeadSha: "a".repeat(40),
  reviewers: [],
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
    organization: { id: uuidv7(), name: "Workspace", urlKey: "workspace" },
    owner: { id: owner.id, name: "Owner", email: "owner@example.com" },
  });
  function push(name: string, args: unknown) {
    expect(server.push(owner, { clientId: uuidv7(), mutations: [{ id: 1, name, args, ts: time }] })).toMatchObject({
      rejected: [],
    });
  }
  function team(key: string, visibility: "private" | "public" = "public") {
    const id = uuidv7();
    push("teamCreate", {
      id,
      name: key,
      key,
      visibility,
      membershipId: uuidv7(),
      stateIds: { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() },
    });
    return id;
  }
  function issue(teamId: string, id = uuidv7()) {
    push("issueCreate", { id, teamId, title: "A task", subscriptionId: uuidv7() });
    return server.store.get("issue", id)!;
  }
  function bind(teamId: string) {
    const id = uuidv7();
    server.github("githubRepositoryConfigure", { id, teamId, source }, owner);
    return id;
  }
  const teamId = team("ENG"),
    first = issue(teamId),
    bindingId = bind(teamId);
  function queue(number = 9) {
    const deliveryId = uuidv7();
    const delivery = {
      kind: "pull_request" as const,
      deliveryId,
      installationId: source.installationId,
      repositoryId: source.repositoryId,
      number,
    };
    expect(queueGitHubDelivery(driver, server, delivery)).toEqual({ queued: true });
    expect(queueGitHubDelivery(driver, server, delivery)).toEqual({ queued: false });
    return driver.all("SELECT * FROM scheduled_job WHERE dedup_key=?", [
      `github:${source.installationId}:${deliveryId}`,
    ])[0]!;
  }
  const run = (job: Record<string, unknown>, value = snapshot) =>
    consumeGitHubJob(driver, server, job, async () => value);
  return { db, driver, server, push, team, issue, bind, teamId, first, bindingId, queue, run };
}

it("discovers multiple canonical IDs only in mapped teams, preserving private projections and human status", async () => {
  const f = fixture();
  try {
    const second = f.issue(f.teamId),
      privateTeam = f.team("OPS", "private"),
      privateIssue = f.issue(privateTeam);
    f.bind(privateTeam);
    const otherTeam = f.team("OTHER"),
      ignored = f.issue(otherTeam);
    const before = [f.first, second, privateIssue, ignored].map((i) => f.server.store.get("issue", i.id));
    await f.run(f.queue(), { ...snapshot, title: "ENG-1, OPS-1, OTHER-1, ENG-20abc", headRef: "eng-2_fix/ENG-1" });
    expect(
      f.server.store
        .list("issuePullRequest")
        .map((r) => r.issueId)
        .sort(),
    ).toEqual([f.first.id, second.id, privateIssue.id].sort());
    expect([f.first, second, privateIssue, ignored].map((i) => f.server.store.get("issue", i.id))).toEqual(before);
    f.server.system("memberSync", { id: "reader", name: "Reader", email: "reader@example.com" });
    const visible = f.server.bootstrap({ id: "reader", type: "user" }, "reader");
    expect(visible.rows.issuePullRequest?.map((r) => r.issueId).sort()).toEqual([f.first.id, second.id].sort());
    expect(JSON.stringify(visible)).not.toContain(privateIssue.id);
    expect(f.driver.all("SELECT * FROM scheduled_job WHERE kind=?", [GITHUB_JOB])).toHaveLength(0);
    expect(
      f.server
        .events(owner)
        .filter((e) => e.type === "GitHubPullRequestLinked")
        .every((e) => e.actor.type === "integration"),
    ).toBe(true);
  } finally {
    f.db.close();
  }
});

it("honors manual unlink across admitted work and future reference edits until explicit manual linking", async () => {
  const f = fixture();
  try {
    await f.run(f.queue());
    const oldJob = f.queue(),
      link = f.server.store.list("issuePullRequest")[0]!;
    let release!: (value: GitHubPullRequestSnapshot) => void;
    const pending = new Promise<GitHubPullRequestSnapshot>((resolve) => {
      release = resolve;
    });
    const running = consumeGitHubJob(f.driver, f.server, oldJob, async () => pending);
    f.push("issuePullRequestUnlink", { id: link.id });
    const edited = { ...snapshot, title: "Revised ENG-1", providerUpdatedAt: "2026-11-01T12:01:00.000Z" };
    release(edited);
    await running;
    expect(f.server.store.list("issuePullRequest")).toHaveLength(0);
    await f.run(f.queue(), { ...snapshot, headSha: "b".repeat(40), providerUpdatedAt: edited.providerUpdatedAt });
    expect(f.server.store.list("issuePullRequest")).toHaveLength(0);
    await f.run(f.queue(), edited);
    expect(f.server.store.list("issuePullRequest")).toHaveLength(0);
    const manualId = uuidv7();
    f.server.github(
      "githubPullRequestLink",
      {
        id: manualId,
        issueId: f.first.id,
        issueIncarnation: issueIncarnation(f.first),
        repositoryBindingId: f.bindingId,
        revision: reserveGitHubRevision(f.driver),
        snapshot: edited,
      },
      owner,
      edited.url,
    );
    await f.run(f.queue(), { ...edited, title: "Tracked manually ENG-1" });
    expect(f.server.store.list("issuePullRequest")).toMatchObject([
      { id: manualId, issueId: f.first.id, title: "Tracked manually ENG-1" },
    ]);
  } finally {
    f.db.close();
  }
});

it("rechecks admission and current incarnation after I/O before linking a newly created replacement", async () => {
  const f = fixture();
  try {
    const job = f.queue();
    let release!: (value: GitHubPullRequestSnapshot) => void;
    const pending = new Promise<GitHubPullRequestSnapshot>((resolve) => {
      release = resolve;
    });
    const running = consumeGitHubJob(f.driver, f.server, job, async () => pending);
    f.push("issueTrash", { id: f.first.id, trashed: true });
    f.push("issueDelete", { id: f.first.id });
    const replacement = f.issue(f.teamId, f.first.id);
    expect(replacement.createdSeq).toBeGreaterThan(f.first.createdSeq);
    const current = { ...snapshot, title: `ENG-${replacement.number}`, headRef: `eng-${replacement.number}_fix` };
    release(current);
    await running;
    expect(f.server.store.list("issuePullRequest")).toHaveLength(0);
    await f.run(f.queue(), current);
    expect(f.server.store.list("issuePullRequest")).toMatchObject([{ issueId: replacement.id }]);
  } finally {
    f.db.close();
  }
});

it("scopes unlink suppression to the removed PR and repository connection", async () => {
  const f = fixture();
  try {
    await f.run(f.queue());
    f.push("issuePullRequestUnlink", { id: f.server.store.list("issuePullRequest")[0]!.id });
    await f.run(f.queue(10), {
      ...snapshot,
      number: 10,
      url: `${source.url}/pull/10`,
      checksUrl: `${source.url}/pull/10/checks`,
    });
    expect(f.server.store.list("issuePullRequest")).toMatchObject([{ number: 10 }]);
    f.server.github("githubRepositoryDisconnect", { id: f.bindingId }, owner);
    const newBinding = f.bind(f.teamId);
    await f.run(f.queue());
    expect(f.server.store.list("issuePullRequest")).toMatchObject([{ number: 9, repositoryBindingId: newBinding }]);
  } finally {
    f.db.close();
  }
});

it.each(["disconnect", "revoke"] as const)(
  "does not attach an in-flight observation to a new binding after %s",
  async (kind) => {
    const f = fixture();
    try {
      const job = f.queue();
      let release!: (value: GitHubPullRequestSnapshot) => void;
      const pending = new Promise<GitHubPullRequestSnapshot>((resolve) => {
        release = resolve;
      });
      const running = consumeGitHubJob(f.driver, f.server, job, async () => pending);
      if (kind === "disconnect") f.server.github("githubRepositoryDisconnect", { id: f.bindingId }, owner);
      else
        queueGitHubDelivery(f.driver, f.server, {
          kind: "revoke",
          deliveryId: uuidv7(),
          installationId: source.installationId,
        });
      const replacementBinding = f.bind(f.teamId);
      release(snapshot);
      await running;
      expect(f.server.store.list("issuePullRequest")).toHaveLength(0);
      await f.run(f.queue());
      expect(f.server.store.list("issuePullRequest")).toMatchObject([{ repositoryBindingId: replacementBinding }]);
    } finally {
      f.db.close();
    }
  },
);

it("checkpoints successful mapped targets and retries only the failed target", async () => {
  const f = fixture();
  try {
    const otherTeam = f.team("OPS");
    f.issue(otherTeam);
    f.bind(otherTeam);
    const job = f.queue(),
      value = { ...snapshot, title: "ENG-1 OPS-1" };
    let fetches = 0;
    await expect(
      consumeGitHubJob(f.driver, f.server, job, async () => {
        if (++fetches === 2) throw new Error("Provider temporarily unavailable");
        return value;
      }),
    ).rejects.toThrow("temporarily unavailable");
    expect(f.server.store.list("issuePullRequest")).toHaveLength(1);
    const retained = f.driver.all("SELECT * FROM scheduled_job WHERE id=?", [String(job["id"])])[0]!;
    expect(JSON.parse(String(retained["payload"])).completed).toHaveLength(1);
    await consumeGitHubJob(f.driver, f.server, retained, async () => {
      ++fetches;
      return value;
    });
    expect(fetches).toBe(3);
    expect(f.server.store.list("issuePullRequest")).toHaveLength(2);
    expect(f.driver.all("SELECT * FROM scheduled_job WHERE id=?", [String(job["id"])])).toHaveLength(0);
  } finally {
    f.db.close();
  }
});

it("keeps pre-discovery durable jobs observation-only and rejects a mismatched canonical PR", async () => {
  const f = fixture();
  try {
    await f.run(f.queue());
    const legacy = f.queue(),
      payload = JSON.parse(String(legacy["payload"]));
    delete payload.admittedEventSeq;
    for (const target of payload.targets) delete target.teamId;
    let fetched = false;
    await consumeGitHubJob(f.driver, f.server, { ...legacy, payload: JSON.stringify(payload) }, async () => {
      fetched = true;
      return { ...snapshot, title: "Legacy observation ENG-1" };
    });
    expect(fetched).toBe(true);
    expect(f.server.store.list("issuePullRequest")).toMatchObject([{ title: "Legacy observation ENG-1" }]);
    const unlinked = f.queue(),
      oldPayload = JSON.parse(String(unlinked["payload"]));
    delete oldPayload.admittedEventSeq;
    for (const target of oldPayload.targets) delete target.teamId;
    f.push("issuePullRequestUnlink", { id: f.server.store.list("issuePullRequest")[0]!.id });
    await consumeGitHubJob(f.driver, f.server, { ...unlinked, payload: JSON.stringify(oldPayload) }, async () => {
      throw new Error("An old removed association must not be fetched");
    });
    const fresh = f.queue();
    await expect(f.run(fresh, { ...snapshot, number: 10 })).rejects.toThrow("different pull request");
    expect(f.driver.all("SELECT * FROM scheduled_job WHERE id=?", [String(fresh["id"])])).toHaveLength(1);
    expect(f.server.store.list("issuePullRequest")).toHaveLength(0);
  } finally {
    f.db.close();
  }
});

it.each(["trash", "archive", "move"] as const)(
  "does not create a link after an issue is %s during I/O",
  async (change) => {
    const f = fixture();
    try {
      const other = f.team("OTHER"),
        job = f.queue();
      let release!: (value: GitHubPullRequestSnapshot) => void;
      const pending = new Promise<GitHubPullRequestSnapshot>((resolve) => {
        release = resolve;
      });
      const running = consumeGitHubJob(f.driver, f.server, job, async () => pending);
      if (change === "trash") f.push("issueTrash", { id: f.first.id, trashed: true });
      else if (change === "archive") f.push("issueArchive", { id: f.first.id, archived: true });
      else f.push("issueUpdate", { id: f.first.id, patch: { teamId: other } });
      release(snapshot);
      await running;
      expect(f.server.store.list("issuePullRequest")).toHaveLength(0);
    } finally {
      f.db.close();
    }
  },
);
