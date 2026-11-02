import { expect, it } from "vitest";
import { uuidv7, type Row } from "@kanbun/model";
import { issueIncarnation, type BootstrapResponse, type PushResponse } from "@kanbun/sync";
import { startEmailRuntime, nativeAgent, emailLink, linkToken } from "./email-runtime";

it("persists link-only Slack attachments with scoped authorization, deduplication and replacement protection", async () => {
  const runtime = await startEmailRuntime();
  try {
    const owner = nativeAgent(runtime);
    await owner.requestLink(runtime.ownerEmail);
    await owner.consume(linkToken(emailLink((await runtime.capturedEmails()).at(-1)!)));
    await owner.fetch("/api/context");
    const initial = (await (
      await owner.fetch("/sync/bootstrap?clientId=slack-attachments-reader")
    ).json()) as BootstrapResponse;
    const teamId = String(initial.rows.team![0]!.id);
    const mutations = new Map<typeof owner, number>();
    async function push(name: string, args: unknown, agent = owner) {
      const mutation = (mutations.get(agent) ?? 0) + 1;
      mutations.set(agent, mutation);
      const result = (await (
        await agent.json("/sync/push", {
          clientId: `attachments-${agent === owner ? "owner" : "member"}`,
          mutations: [{ id: mutation, name, args, ts: new Date().toISOString() }],
        })
      ).json()) as PushResponse;
      if (!result.ok) throw new Error(result.error);
      return result;
    }
    async function issue(team = teamId, id = uuidv7()) {
      expect(
        await push("issueCreate", { id, teamId: team, title: "Linked discussion", subscriptionId: uuidv7() }),
      ).toMatchObject({ rejected: [] });
      const data = (await (
        await owner.fetch(`/sync/bootstrap?clientId=reader-${uuidv7()}`)
      ).json()) as BootstrapResponse;
      return data.rows.issue!.find((row) => row.id === id)! as Row<"issue">;
    }
    const task = await issue();
    const id = uuidv7();
    const url = "https://example.slack.com/archives/C123ABC/p1234567890123456";
    const args = { id, issueId: task.id, issueIncarnation: issueIncarnation(task), url, title: "<!here> & discussion" };
    expect(await push("issueSlackMessageAttach", args)).toMatchObject({ rejected: [] });
    expect(
      await push("issueSlackMessageAttach", {
        ...args,
        id: uuidv7(),
        url: url + "?thread_ts=1234567890.123456&cid=C123ABC",
      }),
    ).toMatchObject({ rejected: [] });
    const load = async (issueId = task.id, agent = owner) =>
      agent.fetch(`/sync/load?model=attachment&parentId=${issueId}`);
    expect(await (await load()).json()).toMatchObject({
      rows: [{ id, url, title: "<!here> & discussion", sourceType: "slack" }],
    });
    const bad = await push("issueSlackMessageAttach", {
      ...args,
      id: uuidv7(),
      url: "https://example.slack.com.evil.test/archives/C123/p1234567890123456",
    });
    expect(bad.rejected).toHaveLength(1);
    const invitation = (await (
      await owner.json("/api/invitations", { email: "slack-links-member@datafog.ai" })
    ).json()) as { token: string };
    const member = nativeAgent(runtime);
    await member.requestLink("slack-links-member@datafog.ai");
    await member.consume(linkToken(emailLink((await runtime.capturedEmails()).at(-1)!)));
    expect((await member.json("/api/invitations/accept", { token: invitation.token })).status).toBe(200);
    const privateTeam = uuidv7();
    expect(
      await push("teamCreate", {
        id: privateTeam,
        name: "Private",
        key: "SEC",
        visibility: "private",
        membershipId: uuidv7(),
        stateIds: { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() },
      }),
    ).toMatchObject({ rejected: [] });
    const secret = await issue(privateTeam);
    const hidden = { ...args, id: uuidv7(), issueId: secret.id, issueIncarnation: issueIncarnation(secret) };
    expect((await push("issueSlackMessageAttach", hidden, member)).rejected).toHaveLength(1);
    expect(await push("issueSlackMessageAttach", hidden)).toMatchObject({ rejected: [] });
    expect((await load(secret.id, member)).status).toBe(403);
    expect(
      (
        await push("issueSlackMessageDetach", {
          id: hidden.id,
          issueId: task.id,
          issueIncarnation: args.issueIncarnation,
        })
      ).rejected,
    ).toHaveLength(1);
    expect(
      await push("issueSlackMessageDetach", { id, issueId: task.id, issueIncarnation: args.issueIncarnation }, member),
    ).toMatchObject({ rejected: [] });
    expect(await (await load()).json()).toMatchObject({ rows: [] });
    expect(await push("issueTrash", { id: task.id, trashed: true })).toMatchObject({ rejected: [] });
    expect((await push("issueSlackMessageAttach", { ...args, id: uuidv7() })).rejected).toHaveLength(1);
    expect(await push("issueDelete", { id: task.id })).toMatchObject({ rejected: [] });
    await issue(teamId, task.id);
    expect((await push("issueSlackMessageAttach", { ...args, id: uuidv7() })).rejected).toHaveLength(1);
    // Link-only operations work without any Slack app credentials or connection.
    expect(await (await owner.fetch("/api/integrations/slack")).json()).toMatchObject({
      configured: false,
      connection: null,
    });
  } finally {
    await runtime.close();
  }
});
