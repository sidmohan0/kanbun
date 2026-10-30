/**
 * The model registry: the single list of synced models, their tables, and
 * how each is synced. Both the sync server (DO) and the sync client read it.
 */
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import * as ws from "./workspace";

export type SyncPolicy =
  /** Sent whole at bootstrap; every change streamed. */
  | { kind: "full" }
  /** Only rows belonging to the viewer are sent (column names the viewer). */
  | { kind: "perUser"; userColumn: string }
  /** Not in the bootstrap; fetched on demand by parent, then streamed. */
  | { kind: "onDemand"; parentColumn: string };

export type ModelDef = {
  name: string;
  table: SQLiteTable;
  policy: SyncPolicy;
  /**
   * Column holding the team id for private-team filtering; null = workspace-wide.
   * Rows that hang off an issue carry the issue's team denormalised, so every
   * scoped model filters on its own column and the log scopes every write.
   */
  teamColumn: string | null;
};

const def = <T extends SQLiteTable>(name: string, table: T, policy: SyncPolicy, teamColumn: string | null = null) =>
  ({ name, table, policy, teamColumn }) satisfies ModelDef;

export const models = {
  organization: def("organization", ws.organization, { kind: "full" }),
  user: def("user", ws.user, { kind: "full" }),
  agent: def("agent", ws.agent, { kind: "full" }),
  userSettings: def("userSettings", ws.userSettings, { kind: "perUser", userColumn: "userId" }),
  team: def("team", ws.team, { kind: "full" }, "id"),
  teamMembership: def("teamMembership", ws.teamMembership, { kind: "full" }, "teamId"),
  favorite: def("favorite", ws.favorite, { kind: "perUser", userColumn: "ownerId" }),
  workflowState: def("workflowState", ws.workflowState, { kind: "full" }, "teamId"),
  issueLabel: def("issueLabel", ws.issueLabel, { kind: "full" }, "teamId"),
  issue: def("issue", ws.issue, { kind: "full" }, "teamId"),
  issueLabelLink: def("issueLabelLink", ws.issueLabelLink, { kind: "full" }, "teamId"),
  issueSubscription: def("issueSubscription", ws.issueSubscription, { kind: "full" }, "teamId"),
  issueRelation: def("issueRelation", ws.issueRelation, { kind: "full" }, "teamId"),
  comment: def("comment", ws.comment, { kind: "onDemand", parentColumn: "issueId" }, "teamId"),
  reaction: def("reaction", ws.reaction, { kind: "onDemand", parentColumn: "issueId" }, "teamId"),
  attachment: def("attachment", ws.attachment, { kind: "onDemand", parentColumn: "issueId" }, "teamId"),
  draft: def("draft", ws.draft, { kind: "perUser", userColumn: "userId" }),
  template: def("template", ws.template, { kind: "full" }, "teamId"),
  documentContent: def("documentContent", ws.documentContent, { kind: "full" }, "teamId"),
  customView: def("customView", ws.customView, { kind: "full" }, "teamId"),
  viewPreferences: def("viewPreferences", ws.viewPreferences, { kind: "full" }),
  notification: def("notification", ws.notification, { kind: "perUser", userColumn: "userId" }, "teamId"),
  notificationSubscription: def("notificationSubscription", ws.notificationSubscription, {
    kind: "perUser",
    userColumn: "subscriberId",
  }),
  cycle: def("cycle", ws.cycle, { kind: "full" }, "teamId"),
  project: def("project", ws.project, { kind: "full" }),
  projectStatus: def("projectStatus", ws.projectStatus, { kind: "full" }, "teamId"),
  projectMilestone: def("projectMilestone", ws.projectMilestone, { kind: "full" }),
  projectTeam: def("projectTeam", ws.projectTeam, { kind: "full" }, "teamId"),
} as const satisfies Record<string, ModelDef>;

export type ModelName = keyof typeof models;
export const modelNames = Object.keys(models) as ModelName[];
export const modelDefs: Record<ModelName, ModelDef> = models;

export type Row<M extends ModelName> = (typeof models)[M]["table"]["$inferSelect"];
export type Insert<M extends ModelName> = (typeof models)[M]["table"]["$inferInsert"];

/** Tables that are not synced models but live in the same database. */
export const internalTables = {
  workspaceBranch: ws.workspaceBranch,
  branchMerge: ws.branchMerge,
  branchRow: ws.branchRow,
  eventLog: ws.eventLog,
  syncLog: ws.syncLog,
  syncClient: ws.syncClient,
  scheduledJob: ws.scheduledJob,
} as const;
