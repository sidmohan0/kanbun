import { expect, it } from "vitest";
import { modelNames } from "@kanbun/model";
import { MemoryStore, issueIncarnation } from "@kanbun/sync";
import { SyncServer } from "@kanbun/sync/server";
import { openWorkspaceDb } from "@kanbun/sync/server/node";
import { applyAttachmentEvent, canonicalSlackMessageUrl, mutators } from "../src";

it("accepts copied Slack message links and rejects destinations that are not canonical Slack messages", () => {
  const url = "https://example.slack.com/archives/C123ABC/p1234567890123456";
  expect(canonicalSlackMessageUrl(url)).toBe(url);
  expect(canonicalSlackMessageUrl(url + "?cid=C123ABC&thread_ts=1234567890.123456")).toBe(
    url + "?thread_ts=1234567890.123456",
  );
  for (const input of [
    url.replace("https:", "http:"),
    url.replace("example.slack.com", "example.slack.com.evil.test"),
    url.replace("example.slack.com", "user@example.slack.com"),
    url + "#anchor",
    url + "?secret=1",
    url + "?cid=COTHER",
    url + "?thread_ts=bad",
    url + "?cid=C123ABC&cid=C123ABC",
    url.replace("/p", "/../p"),
    "javascript:alert(1)",
    "https://slack.com/archives/C123ABC/p1234567890123456",
  ])
    expect(() => canonicalSlackMessageUrl(input)).toThrow("Enter a Slack message link");
});

it("replays human attachment facts identically in memory and SQLite without provider side effects", () => {
  const id = (n: number) => `019a0000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
  const time = "2026-11-01T00:00:00.000Z";
  const actor = { id: "owner", type: "user" } as const;
  const actual = openWorkspaceDb(),
    replay = openWorkspaceDb();
  const server = new SyncServer({ driver: actual.driver, mutators, now: () => time });
  const other = new SyncServer({ driver: replay.driver, mutators, now: () => time });
  let mutation = 0;
  function push(name: string, args: unknown) {
    expect(
      server.push(actor, { clientId: "attachments", mutations: [{ id: ++mutation, name, args, ts: time }] }),
    ).toMatchObject({ rejected: [] });
  }
  try {
    server.system("workspaceInit", {
      organization: { id: id(1), name: "Example", urlKey: "example" },
      owner: { id: actor.id, name: "Owner", email: "owner@example.com" },
    });
    push("teamCreate", {
      id: id(2),
      name: "Engineering",
      key: "ENG",
      membershipId: id(8),
      stateIds: { backlog: id(3), todo: id(4), inProgress: id(5), done: id(6), canceled: id(7) },
    });
    push("issueCreate", { id: id(9), teamId: id(2), title: "Discussion", subscriptionId: id(10) });
    const memory = new MemoryStore();
    for (const model of modelNames)
      for (const row of server.store.list(model)) {
        memory.insert(model, row);
        other.store.insert(model, row);
      }
    const incarnation = issueIncarnation(server.store.get("issue", id(9))!);
    const args = {
      id: id(11),
      issueId: id(9),
      issueIncarnation: incarnation,
      url: "https://example.slack.com/archives/C123/p1234567890123456",
      title: "Discussion",
    };
    push("issueSlackMessageAttach", args);
    push("issueSlackMessageAttach", { ...args, id: id(12) });
    const facts = server.events(actor).filter((event) => event.type === "SlackMessageAttached");
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ actor, sourceRef: null });
    for (const store of [memory, other.store]) {
      applyAttachmentEvent({ store, actor, actorId: actor.id, server: false, now: time }, facts[0]!);
      expect(store.list("attachment")).toEqual(server.store.list("attachment"));
    }
    push("issueSlackMessageDetach", { id: id(11), issueId: id(9), issueIncarnation: incarnation });
    const detached = server.events(actor).find((event) => event.type === "SlackMessageDetached")!;
    for (const store of [memory, other.store]) {
      applyAttachmentEvent({ store, actor, actorId: actor.id, server: false, now: time }, detached);
      expect(store.list("attachment")).toEqual([]);
    }
  } finally {
    actual.db.close();
    replay.db.close();
  }
});
