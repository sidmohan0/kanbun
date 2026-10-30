import { uuidv7 } from "@kanbun/model";
import { MutationError, type Actor, type Mutation } from "@kanbun/sync";
import type { SqlDriver, SyncServer } from "@kanbun/sync/server";

/** Synthetic local identities; these are never accepted from request bodies. */
export const localActors = {
  alice: { id: "user-alice", type: "user" },
  bob: { id: "user-bob", type: "user" },
} as const satisfies Record<string, Actor>;

const seedClient = "kanbun-local-seed";

/** Reuse the local workspace and its recorded seed identity across DO restarts. */
export function seedWorkspace(server: SyncServer, driver: SqlDriver, seedIssue: boolean) {
  return driver.transaction(() => {
    if (!server.store.list("organization").length)
      server.system("workspaceInit", {
        organization: { id: uuidv7(), name: "Local workspace", urlKey: "local-workspace" },
        owner: { id: localActors.alice.id, name: "Alice", email: "alice@example.com" },
      });
    for (const [name, actor] of Object.entries(localActors))
      if (!server.store.get("user", actor.id))
        server.system("memberSync", {
          id: actor.id,
          name: name === "alice" ? "Alice" : "Bob",
          email: `${name}@example.com`,
        });

    const alice = server.store.get("user", localActors.alice.id);
    if (!alice?.active || alice.archivedAt) throw new MutationError("Local member is not active", "forbidden");
    const existingTeam = server.store.list("team", { key: "REC" })[0];
    const teamId = existingTeam?.id ?? uuidv7();
    // The semantic seed fact retains the shared issue ID even after its title changes.
    const existingIssue = driver.all(
      "SELECT entity_id FROM event_log WHERE branch_id = 'main' AND client_id = ? AND type = 'IssueCreated' ORDER BY seq LIMIT 1",
      [seedClient],
    )[0]?.["entity_id"];
    const issueId = typeof existingIssue === "string" ? existingIssue : seedIssue ? uuidv7() : "";
    let nextId = Number(
      driver.all("SELECT last_mutation_id FROM sync_client WHERE client_id = ?", [seedClient])[0]?.[
        "last_mutation_id"
      ] ?? 0,
    );
    const mutations: Mutation[] = [];
    const add = (name: string, args: unknown) =>
      mutations.push({ id: ++nextId, name, args, ts: new Date().toISOString() });
    if (!existingTeam)
      add("teamCreate", {
        id: teamId,
        name: "Recovery",
        key: "REC",
        visibility: "public",
        membershipId: uuidv7(),
        stateIds: { backlog: uuidv7(), todo: uuidv7(), inProgress: uuidv7(), done: uuidv7(), canceled: uuidv7() },
      });
    if (!server.store.list("teamMembership", { teamId, userId: localActors.bob.id }).length)
      add("teamMembershipCreate", { id: uuidv7(), teamId, userId: localActors.bob.id });
    if (seedIssue && !existingIssue)
      add("issueCreate", { id: issueId, teamId, title: "Shared issue", subscriptionId: uuidv7() });
    if (mutations.length) {
      const result = server.push(localActors.alice, { clientId: seedClient, mutations });
      if (!result.ok || result.rejected.length) throw new Error("Local workspace seed failed");
    }
    return { teamId, issueId };
  });
}
