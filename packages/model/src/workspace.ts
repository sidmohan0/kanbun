/**
 * Workspace schema: lives in one SQLite database inside the workspace's
 * Durable Object. Internal bookkeeping tables are excluded from the
 * synced model registry (see registry.ts for sync policy).
 *
 * Field names are chosen so that a future import from an existing tracker
 * maps 1:1 onto them.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  bool,
  json,
  syncedColumns,
  ISSUE_RELATION_TYPES,
  PRIORITIES,
  TEAM_VISIBILITY,
  WORKFLOW_STATE_TYPES,
  ACTOR_TYPES,
  type IssueRelationType,
  type NotificationCategory,
  type Priority,
  type ActorType,
  type TeamVisibility,
  type UserRole,
  type WorkflowStateType,
} from "./common";

/** `CHECK (col IN (...))` for an enum column. Values are literals from common.ts, never user input. */
const oneOf = (name: string, col: { name: string }, values: readonly (string | number)[]) =>
  check(name, sql.raw(`"${col.name}" IN (${values.map((v) => (typeof v === "number" ? v : `'${v}'`)).join(", ")})`));
/** Exactly one of the given nullable columns is set. */
const exactlyOne = (name: string, cols: { name: string }[]) =>
  check(name, sql.raw(`(${cols.map((c) => `("${c.name}" IS NOT NULL)`).join(" + ")}) = 1`));

// ---------------------------------------------------------------------------
// Sync bookkeeping (not synced to clients)
// ---------------------------------------------------------------------------

/** Semantic history. Projection writes and their derived sync patches commit with the event. */
export const eventLog = sqliteTable(
  "event_log",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    branchId: text("branch_id").notNull(),
    txnId: text("txn_id").notNull(),
    eventIndex: integer("event_index").notNull(),
    type: text("type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    teamId: text("team_id").notNull(),
    scopeUserId: text("scope_user_id"),
    payload: json<Record<string, unknown>>("payload").notNull(),
    actor: json<{ id: string; type: ActorType; via?: string }>("actor").notNull(),
    clientId: text("client_id"),
    mutationId: integer("mutation_id"),
    sessionId: text("session_id"),
    sourceRef: text("source_ref"),
    causationSeq: integer("causation_seq"),
    reason: text("reason"),
    ts: integer("ts").notNull(),
  },
  (t) => [
    uniqueIndex("event_log_client_mutation_index").on(t.clientId, t.mutationId, t.eventIndex),
    index("event_log_branch_seq").on(t.branchId, t.seq),
    index("event_log_entity").on(t.entityType, t.entityId),
    index("event_log_team_seq").on(t.teamId, t.seq),
    index("event_log_txn").on(t.txnId),
    check("event_log_event_index_nonnegative", sql`${t.eventIndex} >= 0`),
  ],
);

export const syncLog = sqliteTable(
  "sync_log",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    model: text("model").notNull(),
    rowId: text("row_id").notNull(),
    op: text("op", { enum: ["upsert", "delete"] }).notNull(),
    /** Changed fields only for upserts (the full row for inserts); null for deletes. */
    patch: json<Record<string, unknown> | null>("patch"),
    /** Prior values of the patched fields (null for inserts); the deleted row for deletes. */
    prev: json<Record<string, unknown> | null>("prev"),
    actorId: text("actor_id"),
    actorType: text("actor_type").$type<ActorType>().notNull().default("user"),
    clientId: text("client_id"),
    mutationId: integer("mutation_id"),
    /** All rows written by one mutation share a txnId; grouped undo and the activity feed key on it. */
    txnId: text("txn_id").notNull(),
    /** Semantic event that produced this patch; null while a legacy mutator owns the write. */
    eventSeq: integer("event_seq"),
    /** The log entry that triggered this write (the comment an agent replied to, the PR that closed an issue). */
    causationSeq: integer("causation_seq"),
    /** Short free-text reason, mainly for agent writes. */
    reason: text("reason"),
    /** Team scope for permission filtering on pull; null = workspace-wide. */
    teamId: text("team_id"),
    /** The team the row belonged to before this write, when the write moved it; lets a pull turn the move into a delete for viewers of the old team. */
    prevTeamId: text("prev_team_id"),
    /** For perUser models: the owning user; null otherwise. */
    scopeUserId: text("scope_user_id"),
    ts: text("ts").notNull(),
  },
  (t) => [
    index("sync_log_model_row").on(t.model, t.rowId),
    index("sync_log_team").on(t.teamId),
    index("sync_log_prev_team").on(t.prevTeamId),
    index("sync_log_txn").on(t.txnId),
    index("sync_log_event_seq").on(t.eventSeq),
    index("sync_log_actor").on(t.actorType, t.actorId),
    oneOf("sync_log_op_check", t.op, ["upsert", "delete"]),
    oneOf("sync_log_actor_type_check", t.actorType, ACTOR_TYPES),
  ],
);

/**
 * Scheduled work for the DO's single alarm: SLA transitions, cycle rollover,
 * reminders, snooze wake-ups. The alarm handler runs everything due and
 * re-arms for the next fireAt.
 */
export const scheduledJob = sqliteTable(
  "scheduled_job",
  {
    id: text("id").primaryKey(),
    fireAt: text("fire_at").notNull(),
    kind: text("kind").notNull(),
    payload: json<Record<string, unknown>>("payload").notNull(),
    /** Dedup key: re-scheduling the same job replaces it. */
    dedupKey: text("dedup_key"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("scheduled_job_fire_at").on(t.fireAt), uniqueIndex("scheduled_job_dedup").on(t.dedupKey)],
);

export const syncClient = sqliteTable("sync_client", {
  clientId: text("client_id").primaryKey(),
  userId: text("user_id").notNull(),
  lastMutationId: integer("last_mutation_id").notNull().default(0),
  lastSeenAt: text("last_seen_at").notNull(),
  /** Comma-joined sorted team ids visible at last sync; a change forces a re-bootstrap. */
  visibleTeams: text("visible_teams").notNull().default(""),
});

// ---------------------------------------------------------------------------
// Workspace & people
// ---------------------------------------------------------------------------

export const organization = sqliteTable("organization", {
  ...syncedColumns,
  name: text("name").notNull(),
  urlKey: text("url_key").notNull(),
  logoUrl: text("logo_url"),
  gitBranchFormat: text("git_branch_format").notNull().default("{username}/{issueIdentifier}-{issueTitle}"),
  fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1),
  initiativesEnabled: bool("initiatives_enabled").notNull().default(true),
  customersEnabled: bool("customers_enabled").notNull().default(false),
  projectUpdateRemindersDay: text("project_update_reminders_day").notNull().default("Friday"),
  projectUpdateRemindersHour: integer("project_update_reminders_hour").notNull().default(14),
  allowedAuthServices: json<string[]>("allowed_auth_services")
    .notNull()
    .$default(() => ["email", "google", "github"]),
});

/**
 * Mirror of the workspace's members, written only by the system-actor
 * `memberSync` mutation whenever D1 membership changes. Lets assignees,
 * creators and mentions resolve without a cross-store lookup.
 */
export const user = sqliteTable(
  "user",
  {
    ...syncedColumns,
    name: text("name").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email").notNull(),
    avatarUrl: text("avatar_url"),
    avatarBackgroundColor: text("avatar_background_color").notNull(),
    initials: text("initials").notNull(),
    active: bool("active").notNull().default(true),
    role: text("role").$type<UserRole>().notNull().default("user"),
    guest: bool("guest").notNull().default(false),
    timezone: text("timezone"),
    description: text("description"),
    statusEmoji: text("status_emoji"),
    statusLabel: text("status_label"),
    statusUntilAt: text("status_until_at"),
    lastSeen: text("last_seen"),
  },
  (t) => [uniqueIndex("user_email").on(t.email)],
);

export type NotificationChannelPrefs = { desktop: boolean; email: boolean; mobile: boolean };

/** Per-workspace user settings. Theme and editor preferences are per-account and live in D1. */
export const userSettings = sqliteTable("user_settings", {
  ...syncedColumns,
  userId: text("user_id").notNull(),
  notificationCategoryPreferences: json<Partial<Record<NotificationCategory, NotificationChannelPrefs>>>(
    "notification_category_preferences",
  )
    .notNull()
    .$default(() => ({})),
  notificationChannelPreferences: json<NotificationChannelPrefs>("notification_channel_preferences")
    .notNull()
    .$default(() => ({ desktop: true, email: true, mobile: true })),
  autoAssignToSelf: bool("auto_assign_to_self").notNull().default(false),
  sidebar: json<Record<string, unknown>>("sidebar")
    .notNull()
    .$default(() => ({})),
});

/**
 * An agent is a non-human actor with an API key. It uses the same push/pull
 * endpoints as a browser; `scopes` limit which teams, projects and mutators
 * it may touch, and `mode` decides whether its writes commit or land as proposals.
 */
export const agent = sqliteTable(
  "agent",
  {
    ...syncedColumns,
    name: text("name").notNull(),
    description: text("description"),
    avatarUrl: text("avatar_url"),
    ownerId: text("owner_id").notNull(),
    mode: text("mode").$type<"propose" | "commit">().notNull().default("propose"),
    scopes: json<AgentScopes>("scopes")
      .notNull()
      .$default(() => ({ teamIds: [], projectIds: [], mutators: [] })),
    /** Mutations per hour; the DO rejects pushes beyond it. */
    rateBudget: integer("rate_budget").notNull().default(600),
    active: bool("active").notNull().default(true),
    lastActiveAt: text("last_active_at"),
  },
  (t) => [index("agent_owner").on(t.ownerId), oneOf("agent_mode_check", t.mode, ["propose", "commit"])],
);

export type AgentScopes = {
  /** Empty = all teams the owner can see. */
  teamIds: string[];
  projectIds: string[];
  /** Mutator names the agent may call; empty = all. */
  mutators: string[];
};

export const team = sqliteTable(
  "team",
  {
    ...syncedColumns,
    name: text("name").notNull(),
    key: text("key").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    icon: text("icon"),
    color: text("color"),
    timezone: text("timezone").notNull().default("Etc/UTC"),
    visibility: text("visibility").$type<TeamVisibility>().notNull().default("public"),
    parentId: text("parent_id"),
    retiredAt: text("retired_at"),
    // cycles
    cyclesEnabled: bool("cycles_enabled").notNull().default(false),
    cycleDuration: integer("cycle_duration").notNull().default(2),
    cycleCooldownTime: integer("cycle_cooldown_time").notNull().default(0),
    cycleStartDay: integer("cycle_start_day").notNull().default(1),
    cycleLockToActive: bool("cycle_lock_to_active").notNull().default(false),
    cycleIssueAutoAssignStarted: bool("cycle_issue_auto_assign_started").notNull().default(true),
    cycleIssueAutoAssignCompleted: bool("cycle_issue_auto_assign_completed").notNull().default(true),
    upcomingCycleCount: integer("upcoming_cycle_count").notNull().default(2),
    // triage
    triageEnabled: bool("triage_enabled").notNull().default(false),
    requirePriorityToLeaveTriage: bool("require_priority_to_leave_triage").notNull().default(false),
    // estimation
    issueEstimationType: text("issue_estimation_type").notNull().default("notUsed"),
    issueEstimationAllowZero: bool("issue_estimation_allow_zero").notNull().default(true),
    issueEstimationExtended: bool("issue_estimation_extended").notNull().default(false),
    defaultIssueEstimate: real("default_issue_estimate").notNull().default(0),
    // lifecycle
    autoArchivePeriod: integer("auto_archive_period").notNull().default(6),
    autoClosePeriod: integer("auto_close_period"),
    autoCloseStateId: text("auto_close_state_id"),
    autoCloseParentIssues: bool("auto_close_parent_issues").notNull().default(false),
    autoCloseChildIssues: bool("auto_close_child_issues").notNull().default(false),
    defaultIssueStateId: text("default_issue_state_id"),
    triageIssueStateId: text("triage_issue_state_id"),
    inheritWorkflowStatuses: bool("inherit_workflow_statuses").notNull().default(false),
    inheritProjectStatuses: bool("inherit_project_statuses").notNull().default(true),
    setIssueSortOrderOnStateChange: text("set_issue_sort_order_on_state_change").notNull().default("bottom"),
    /** Per-team counter for issue numbers; only the DO increments it. */
    issueCounter: integer("issue_counter").notNull().default(0),
  },
  (t) => [uniqueIndex("team_key").on(t.key), oneOf("team_visibility_check", t.visibility, TEAM_VISIBILITY)],
);

export const teamMembership = sqliteTable(
  "team_membership",
  {
    ...syncedColumns,
    teamId: text("team_id").notNull(),
    userId: text("user_id").notNull(),
    owner: bool("owner").notNull().default(false),
    sortOrder: text("sort_order").notNull(),
  },
  (t) => [uniqueIndex("team_membership_team_user").on(t.teamId, t.userId), index("team_membership_user").on(t.userId)],
);

export const favorite = sqliteTable(
  "favorite",
  {
    ...syncedColumns,
    ownerId: text("owner_id").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    sortOrder: text("sort_order").notNull(),
    folderName: text("folder_name"),
    parentId: text("parent_id"),
    issueId: text("issue_id"),
    projectId: text("project_id"),
    documentId: text("document_id"),
    customViewId: text("custom_view_id"),
    cycleId: text("cycle_id"),
    labelId: text("label_id"),
    initiativeId: text("initiative_id"),
    customerId: text("customer_id"),
    teamId: text("team_id"),
    predefinedViewType: text("predefined_view_type"),
    predefinedViewTeamId: text("predefined_view_team_id"),
  },
  (t) => [index("favorite_owner").on(t.ownerId)],
);

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export const workflowState = sqliteTable(
  "workflow_state",
  {
    ...syncedColumns,
    teamId: text("team_id").notNull(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    description: text("description"),
    type: text("type").$type<WorkflowStateType>().notNull(),
    position: real("position").notNull(),
    inheritedFromId: text("inherited_from_id"),
  },
  (t) => [index("workflow_state_team").on(t.teamId), oneOf("workflow_state_type_check", t.type, WORKFLOW_STATE_TYPES)],
);

export const issueLabel = sqliteTable(
  "issue_label",
  {
    ...syncedColumns,
    /** null = workspace label */
    teamId: text("team_id"),
    name: text("name").notNull(),
    color: text("color").notNull(),
    description: text("description"),
    isGroup: bool("is_group").notNull().default(false),
    groupType: text("group_type"),
    parentId: text("parent_id"),
    creatorId: text("creator_id"),
    retiredAt: text("retired_at"),
    lastAppliedAt: text("last_applied_at"),
  },
  (t) => [index("issue_label_team").on(t.teamId), index("issue_label_parent").on(t.parentId)],
);

export const issue = sqliteTable(
  "issue",
  {
    ...syncedColumns,
    /** Semantic event sequence; 0 for optimistic and pre-event-log rows. */
    createdSeq: integer("created_seq").notNull().default(0),
    updatedSeq: integer("updated_seq").notNull().default(0),
    teamId: text("team_id").notNull(),
    /** Assigned by the DO from team.issueCounter; 0 while optimistic. The identifier `KEY-123` and the branch name are derived at read time. */
    number: integer("number").notNull().default(0),
    title: text("title").notNull(),
    /** Plain-text mirror of the Yjs description, for search and previews. */
    description: text("description"),
    descriptionContentId: text("description_content_id"),
    priority: integer("priority").$type<Priority>().notNull().default(0),
    prioritySortOrder: text("priority_sort_order").notNull(),
    estimate: real("estimate"),
    dueDate: text("due_date"),
    sortOrder: text("sort_order").notNull(),
    boardOrder: text("board_order").notNull(),
    subIssueSortOrder: text("sub_issue_sort_order"),
    stateId: text("state_id").notNull(),
    assigneeId: text("assignee_id"),
    creatorId: text("creator_id"),
    delegateId: text("delegate_id"),
    parentId: text("parent_id"),
    projectId: text("project_id"),
    projectMilestoneId: text("project_milestone_id"),
    cycleId: text("cycle_id"),
    sourceCommentId: text("source_comment_id"),
    lastAppliedTemplateId: text("last_applied_template_id"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    canceledAt: text("canceled_at"),
    triagedAt: text("triaged_at"),
    startedTriageAt: text("started_triage_at"),
    addedToCycleAt: text("added_to_cycle_at"),
    addedToProjectAt: text("added_to_project_at"),
    addedToTeamAt: text("added_to_team_at"),
    autoArchivedAt: text("auto_archived_at"),
    autoClosedAt: text("auto_closed_at"),
    snoozedById: text("snoozed_by_id"),
    snoozedUntilAt: text("snoozed_until_at"),
    slaType: text("sla_type"),
    slaStartedAt: text("sla_started_at"),
    slaMediumRiskAt: text("sla_medium_risk_at"),
    slaHighRiskAt: text("sla_high_risk_at"),
    slaBreachesAt: text("sla_breaches_at"),
    trashed: bool("trashed").notNull().default(false),
  },
  (t) => [
    uniqueIndex("issue_team_number").on(t.teamId, t.number),
    index("issue_team_state").on(t.teamId, t.stateId),
    index("issue_assignee").on(t.assigneeId),
    index("issue_parent").on(t.parentId),
    index("issue_project").on(t.projectId),
    index("issue_cycle").on(t.cycleId),
    oneOf("issue_priority_check", t.priority, PRIORITIES),
  ],
);

export const issueLabelLink = sqliteTable(
  "issue_label_link",
  {
    ...syncedColumns,
    /** Denormalised from the issue so private-team filtering needs no join; kept in step when the issue moves. */
    teamId: text("team_id").notNull(),
    issueId: text("issue_id").notNull(),
    labelId: text("label_id").notNull(),
  },
  (t) => [
    uniqueIndex("issue_label_link_pair").on(t.issueId, t.labelId),
    index("issue_label_link_label").on(t.labelId),
    index("issue_label_link_team").on(t.teamId),
  ],
);

export const issueSubscription = sqliteTable(
  "issue_subscription",
  {
    ...syncedColumns,
    teamId: text("team_id").notNull(),
    issueId: text("issue_id").notNull(),
    userId: text("user_id").notNull(),
  },
  (t) => [
    uniqueIndex("issue_subscription_pair").on(t.issueId, t.userId),
    index("issue_subscription_user").on(t.userId),
    index("issue_subscription_team").on(t.teamId),
  ],
);

export const issueRelation = sqliteTable(
  "issue_relation",
  {
    ...syncedColumns,
    /** The owning issue's team. A relation is visible with its owning issue. */
    teamId: text("team_id").notNull(),
    issueId: text("issue_id").notNull(),
    relatedIssueId: text("related_issue_id").notNull(),
    type: text("type").$type<IssueRelationType>().notNull(),
  },
  (t) => [
    index("issue_relation_issue").on(t.issueId),
    index("issue_relation_related").on(t.relatedIssueId),
    index("issue_relation_team").on(t.teamId),
    oneOf("issue_relation_type_check", t.type, ISSUE_RELATION_TYPES),
  ],
);

export const comment = sqliteTable(
  "comment",
  {
    ...syncedColumns,
    /** The owning issue's team; null when the owner is workspace-wide (a project or initiative update). */
    teamId: text("team_id"),
    /** Plain-text rendering, for search and previews. */
    body: text("body").notNull(),
    /** ProseMirror document JSON. Comments are not co-edited live, so no Yjs. */
    bodyData: json<Record<string, unknown> | null>("body_data"),
    userId: text("user_id"),
    agentId: text("agent_id"),
    parentId: text("parent_id"),
    /** Exactly one owner. */
    issueId: text("issue_id"),
    projectUpdateId: text("project_update_id"),
    initiativeUpdateId: text("initiative_update_id"),
    documentContentId: text("document_content_id"),
    /** Inline-thread anchor inside a document (Yjs relative position), when documentContentId is set. */
    anchor: text("anchor"),
    quotedText: text("quoted_text"),
    editedAt: text("edited_at"),
    resolvedAt: text("resolved_at"),
    resolvingUserId: text("resolving_user_id"),
    resolvingCommentId: text("resolving_comment_id"),
  },
  (t) => [
    index("comment_issue").on(t.issueId),
    index("comment_parent").on(t.parentId),
    index("comment_team").on(t.teamId),
    exactlyOne("comment_owner_check", [t.issueId, t.projectUpdateId, t.initiativeUpdateId, t.documentContentId]),
    check("comment_author_check", sql.raw(`("user_id" IS NOT NULL) + ("agent_id" IS NOT NULL) = 1`)),
  ],
);

export const reaction = sqliteTable(
  "reaction",
  {
    ...syncedColumns,
    /** Team of the issue the reaction (or its comment) belongs to; null for workspace-wide targets. */
    teamId: text("team_id"),
    emoji: text("emoji").notNull(),
    userId: text("user_id").notNull(),
    /** Always set for reactions under an issue, including reactions to its comments. */
    issueId: text("issue_id"),
    /** The comment reacted to, when the target is a comment rather than the issue itself. */
    commentId: text("comment_id"),
    projectUpdateId: text("project_update_id"),
    initiativeUpdateId: text("initiative_update_id"),
  },
  (t) => [
    index("reaction_issue").on(t.issueId),
    index("reaction_comment").on(t.commentId),
    index("reaction_team").on(t.teamId),
    // The owner is the issue (also for reactions on an issue's comments, so they load with the issue), a project update or an initiative update.
    exactlyOne("reaction_owner_check", [t.issueId, t.projectUpdateId, t.initiativeUpdateId]),
  ],
);

export const attachment = sqliteTable(
  "attachment",
  {
    ...syncedColumns,
    teamId: text("team_id").notNull(),
    issueId: text("issue_id").notNull(),
    creatorId: text("creator_id"),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    url: text("url").notNull(),
    sourceType: text("source_type"),
    metadata: json<Record<string, unknown>>("metadata")
      .notNull()
      .$default(() => ({})),
    groupBySource: bool("group_by_source").notNull().default(false),
  },
  (t) => [index("attachment_issue").on(t.issueId), index("attachment_team").on(t.teamId)],
);

/**
 * Unsent work: a new issue being composed, or a comment/update body in
 * progress for an existing entity. `kind` says which; `data` is the
 * structured draft (title, stateId, labelIds... or a ProseMirror doc).
 */
export const draft = sqliteTable(
  "draft",
  {
    ...syncedColumns,
    userId: text("user_id").notNull(),
    kind: text("kind").$type<"issue" | "comment" | "projectUpdate" | "initiativeUpdate" | "document">().notNull(),
    teamId: text("team_id"),
    issueId: text("issue_id"),
    parentCommentId: text("parent_comment_id"),
    projectId: text("project_id"),
    initiativeId: text("initiative_id"),
    documentId: text("document_id"),
    data: json<Record<string, unknown>>("data").notNull(),
    wasLocalDraft: bool("was_local_draft").notNull().default(false),
  },
  (t) => [index("draft_user").on(t.userId)],
);

export const template = sqliteTable(
  "template",
  {
    ...syncedColumns,
    teamId: text("team_id"),
    creatorId: text("creator_id"),
    lastUpdatedById: text("last_updated_by_id"),
    name: text("name").notNull(),
    description: text("description"),
    icon: text("icon"),
    color: text("color"),
    type: text("type").notNull(),
    templateData: json<Record<string, unknown>>("template_data").notNull(),
    sortOrder: text("sort_order").notNull(),
    lastAppliedAt: text("last_applied_at"),
  },
  (t) => [index("template_team").on(t.teamId)],
);

// ---------------------------------------------------------------------------
// Rich text (bodies live in Document DOs; this is the index + text mirror)
// ---------------------------------------------------------------------------

export const documentContent = sqliteTable(
  "document_content",
  {
    ...syncedColumns,
    /** Exactly one owner. */
    issueId: text("issue_id"),
    documentId: text("document_id"),
    projectId: text("project_id"),
    initiativeId: text("initiative_id"),
    projectMilestoneId: text("project_milestone_id"),
    commentId: text("comment_id"),
    /** Plain-text mirror for search; the Yjs state is in the Document DO. */
    content: text("content"),
    /** Hash of the Yjs state vector the mirror was taken from. */
    contentState: text("content_state"),
    restoredAt: text("restored_at"),
  },
  (t) => [index("document_content_issue").on(t.issueId), index("document_content_document").on(t.documentId)],
);

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export const customView = sqliteTable(
  "custom_view",
  {
    ...syncedColumns,
    name: text("name").notNull(),
    slugId: text("slug_id").notNull(),
    description: text("description"),
    icon: text("icon"),
    color: text("color"),
    modelName: text("model_name").notNull().default("issue"),
    filterData: json<Record<string, unknown>>("filter_data")
      .notNull()
      .$default(() => ({})),
    projectFilterData: json<Record<string, unknown> | null>("project_filter_data"),
    shared: bool("shared").notNull().default(false),
    ownerId: text("owner_id").notNull(),
    creatorId: text("creator_id").notNull(),
    updatedById: text("updated_by_id"),
    teamId: text("team_id"),
  },
  (t) => [index("custom_view_owner").on(t.ownerId), index("custom_view_team").on(t.teamId)],
);

export const viewPreferences = sqliteTable(
  "view_preferences",
  {
    ...syncedColumns,
    /** "organization" (shared default) or "user" */
    type: text("type").notNull(),
    userId: text("user_id"),
    viewType: text("view_type").notNull(),
    customViewId: text("custom_view_id"),
    teamId: text("team_id"),
    projectId: text("project_id"),
    cycleId: text("cycle_id"),
    /** Validated by the ViewPreferencesValues zod schema in @kanbun/model. */
    preferences: json<Record<string, unknown>>("preferences")
      .notNull()
      .$default(() => ({})),
  },
  (t) => [
    index("view_preferences_user").on(t.userId),
    index("view_preferences_view").on(t.viewType, t.customViewId, t.teamId),
  ],
);

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const notification = sqliteTable(
  "notification",
  {
    ...syncedColumns,
    userId: text("user_id").notNull(),
    actorId: text("actor_id"),
    type: text("type").notNull(),
    category: text("category").$type<NotificationCategory>().notNull(),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    groupingKey: text("grouping_key").notNull(),
    groupingPriority: real("grouping_priority").notNull().default(0),
    readAt: text("read_at"),
    emailedAt: text("emailed_at"),
    snoozedUntilAt: text("snoozed_until_at"),
    unsnoozedAt: text("unsnoozed_at"),
    issueId: text("issue_id"),
    commentId: text("comment_id"),
    projectId: text("project_id"),
    projectUpdateId: text("project_update_id"),
    initiativeId: text("initiative_id"),
    initiativeUpdateId: text("initiative_update_id"),
    documentId: text("document_id"),
    customerNeedId: text("customer_need_id"),
  },
  (t) => [index("notification_user").on(t.userId, t.readAt), index("notification_issue").on(t.issueId)],
);

export const notificationSubscription = sqliteTable(
  "notification_subscription",
  {
    ...syncedColumns,
    subscriberId: text("subscriber_id").notNull(),
    active: bool("active").notNull().default(true),
    contextViewType: text("context_view_type"),
    teamId: text("team_id"),
    projectId: text("project_id"),
    initiativeId: text("initiative_id"),
    cycleId: text("cycle_id"),
    labelId: text("label_id"),
    customViewId: text("custom_view_id"),
    customerId: text("customer_id"),
    userId: text("user_id"),
  },
  (t) => [index("notification_subscription_subscriber").on(t.subscriberId)],
);

// ---------------------------------------------------------------------------
// Phase-2 entities that phase-1 rows already reference (so FKs resolve).
// Full field sets land in phase 2; these are the minimum columns needed.
// ---------------------------------------------------------------------------

export const cycle = sqliteTable(
  "cycle",
  {
    ...syncedColumns,
    teamId: text("team_id").notNull(),
    number: integer("number").notNull(),
    name: text("name"),
    description: text("description"),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    completedAt: text("completed_at"),
    scopeHistory: json<number[]>("scope_history")
      .notNull()
      .$default(() => []),
    issueCountHistory: json<number[]>("issue_count_history")
      .notNull()
      .$default(() => []),
    completedIssueCountHistory: json<number[]>("completed_issue_count_history")
      .notNull()
      .$default(() => []),
  },
  (t) => [uniqueIndex("cycle_team_number").on(t.teamId, t.number)],
);

export const project = sqliteTable(
  "project",
  {
    ...syncedColumns,
    name: text("name").notNull(),
    slugId: text("slug_id").notNull(),
    description: text("description"),
    contentId: text("content_id"),
    icon: text("icon"),
    color: text("color").notNull(),
    statusId: text("status_id").notNull(),
    priority: integer("priority").$type<Priority>().notNull().default(0),
    prioritySortOrder: text("priority_sort_order").notNull(),
    sortOrder: text("sort_order").notNull(),
    leadId: text("lead_id"),
    leadTeamId: text("lead_team_id"),
    creatorId: text("creator_id"),
    startDate: text("start_date"),
    startDateResolution: text("start_date_resolution"),
    targetDate: text("target_date"),
    targetDateResolution: text("target_date_resolution"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    canceledAt: text("canceled_at"),
    health: text("health"),
    healthUpdatedAt: text("health_updated_at"),
    trashed: bool("trashed").notNull().default(false),
  },
  (t) => [index("project_status_idx").on(t.statusId), index("project_lead").on(t.leadId)],
);

export const projectStatus = sqliteTable("project_status", {
  ...syncedColumns,
  teamId: text("team_id"),
  name: text("name").notNull(),
  color: text("color").notNull(),
  description: text("description"),
  type: text("type").notNull(),
  position: real("position").notNull(),
  indefinite: bool("indefinite").notNull().default(false),
  inheritedFromId: text("inherited_from_id"),
});

export const projectMilestone = sqliteTable(
  "project_milestone",
  {
    ...syncedColumns,
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    targetDate: text("target_date"),
    sortOrder: text("sort_order").notNull(),
    status: text("status").notNull().default("unstarted"),
  },
  (t) => [index("project_milestone_project").on(t.projectId)],
);

export const projectTeam = sqliteTable(
  "project_team",
  {
    ...syncedColumns,
    projectId: text("project_id").notNull(),
    teamId: text("team_id").notNull(),
  },
  (t) => [uniqueIndex("project_team_pair").on(t.projectId, t.teamId)],
);
