import { integer, text } from "drizzle-orm/sqlite-core";

/**
 * Columns every synced entity carries. `id` is a client-generated UUIDv7;
 * timestamps are ISO-8601 strings; `archivedAt` is the soft delete.
 */
export const syncedColumns = {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  archivedAt: text("archived_at"),
} as const;

export const bool = (name: string) => integer(name, { mode: "boolean" });
export const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();

/** Priority scale shared by issues and projects: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
export const PRIORITIES = [0, 1, 2, 3, 4] as const;
export type Priority = (typeof PRIORITIES)[number];

export const WORKFLOW_STATE_TYPES = ["triage", "backlog", "unstarted", "started", "completed", "canceled"] as const;
export type WorkflowStateType = (typeof WORKFLOW_STATE_TYPES)[number];

export const ISSUE_RELATION_TYPES = ["blocks", "duplicate", "related", "similar"] as const;
export type IssueRelationType = (typeof ISSUE_RELATION_TYPES)[number];

export const TEAM_VISIBILITY = ["public", "private"] as const;
export type TeamVisibility = (typeof TEAM_VISIBILITY)[number];

export const ACTOR_TYPES = ["user", "agent", "integration", "system"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const USER_ROLES = ["owner", "admin", "user", "guest"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const NOTIFICATION_CATEGORIES = [
  "assignments",
  "commentsAndReplies",
  "mentions",
  "reactions",
  "statusChanges",
  "subscriptions",
  "triage",
  "reminders",
  "documentChanges",
  "postsAndUpdates",
  "customers",
  "appsAndIntegrations",
  "system",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const LABEL_GROUP_TYPES = ["single", "multi"] as const;
