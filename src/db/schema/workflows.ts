import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { contacts } from "./contacts";
import { connectedAccounts, providerEnum, users } from "./auth";
import { idColumn, timestamps } from "./helpers";

export const taskStatusEnum = pgEnum("task_status", [
  "open",
  "done",
  "snoozed",
]);
export const taskKindEnum = pgEnum("task_kind", [
  "follow_up",
  "sequence_step",
  "import_review",
  "admin",
]);
export const taskMirrorStatusEnum = pgEnum("task_mirror_status", [
  "not_mirrored",
  "queued",
  "synced",
  "degraded",
]);
export const sequenceStatusEnum = pgEnum("sequence_status", [
  "draft",
  "active",
  "paused",
]);
export const enrollmentStatusEnum = pgEnum("enrollment_status", [
  "active",
  "paused",
  "completed",
  "stopped",
]);
export const importStatusEnum = pgEnum("import_status", [
  "draft",
  "queued",
  "processing",
  "completed",
  "completed_with_warnings",
  "failed",
]);
export const importRowStatusEnum = pgEnum("import_row_status", [
  "pending",
  "processing",
  "created",
  "updated",
  "flagged",
  "skipped",
]);
export const importRowActionEnum = pgEnum("import_row_action", [
  "create",
  "update",
  "flag",
  "skip",
]);
export const mergeReviewStatusEnum = pgEnum("merge_review_status", [
  "open",
  "resolved",
  "dismissed",
]);

export const tasks = pgTable(
  "tasks",
  {
    id: idColumn(),
    contactId: text("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    kind: taskKindEnum("kind").default("follow_up").notNull(),
    status: taskStatusEnum("status").default("open").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    todoistItemId: text("todoist_item_id"),
    todoistSyncStatus: taskMirrorStatusEnum("todoist_sync_status")
      .default("not_mirrored")
      .notNull(),
    todoistSyncRequestedAt: timestamp("todoist_sync_requested_at", {
      withTimezone: true,
    }),
    todoistSyncedAt: timestamp("todoist_synced_at", { withTimezone: true }),
    todoistCompletedAt: timestamp("todoist_completed_at", {
      withTimezone: true,
    }),
    todoistLastError: text("todoist_last_error"),
    ...timestamps,
  },
  (table) => [
    index("tasks_contact_id_idx").on(table.contactId),
    index("tasks_due_at_idx").on(table.dueAt),
    index("tasks_todoist_sync_requested_at_idx").on(table.todoistSyncRequestedAt),
  ],
);

export const imports = pgTable(
  "imports",
  {
    id: idColumn(),
    fileName: text("file_name").notNull(),
    fileHash: text("file_hash").notNull(),
    label: text("label"),
    status: importStatusEnum("status").default("processing").notNull(),
    headers: text("headers").array().default([]).notNull(),
    totalRows: integer("total_rows").default(0).notNull(),
    createdCount: integer("created_count").default(0).notNull(),
    updatedCount: integer("updated_count").default(0).notNull(),
    flaggedCount: integer("flagged_count").default(0).notNull(),
    skippedCount: integer("skipped_count").default(0).notNull(),
    warningCount: integer("warning_count").default(0).notNull(),
    detectedMapping: jsonb("detected_mapping")
      .$type<Record<string, string | null>>()
      .default({})
      .notNull(),
    unmappedHeaders: text("unmapped_headers").array().default([]).notNull(),
    mappingWarnings: text("mapping_warnings").array().default([]).notNull(),
    errorMessage: text("error_message"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("imports_file_hash_unique").on(table.fileHash),
    index("imports_created_at_idx").on(table.createdAt),
  ],
);

export const importRows = pgTable(
  "import_rows",
  {
    id: idColumn(),
    importId: text("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    rawData: jsonb("raw_data").default({}).notNull(),
    overrideName: text("override_name"),
    overrideEmail: text("override_email"),
    overrideCompany: text("override_company"),
    overrideTitle: text("override_title"),
    overrideAction: importRowActionEnum("override_action"),
    normalizedName: text("normalized_name"),
    normalizedEmail: text("normalized_email"),
    normalizedCompany: text("normalized_company"),
    normalizedTitle: text("normalized_title"),
    status: importRowStatusEnum("status").notNull(),
    proposedAction: importRowActionEnum("proposed_action").notNull(),
    warning: text("warning"),
    warnings: text("warnings").array().default([]).notNull(),
    contactId: text("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("import_rows_import_row_number_unique").on(
      table.importId,
      table.rowNumber,
    ),
    index("import_rows_import_id_idx").on(table.importId),
    index("import_rows_contact_id_idx").on(table.contactId),
  ],
);

export const sequences = pgTable(
  "sequences",
  {
    id: idColumn(),
    name: text("name").notNull(),
    status: sequenceStatusEnum("status").default("draft").notNull(),
    description: text("description"),
    ...timestamps,
  },
  (table) => [index("sequences_name_idx").on(table.name)],
);

export const contactMergeReviews = pgTable(
  "contact_merge_reviews",
  {
    id: idColumn(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    connectedAccountId: text("connected_account_id").references(
      () => connectedAccounts.id,
      {
        onDelete: "set null",
      },
    ),
    provider: providerEnum("provider").notNull(),
    sourceRef: text("source_ref").notNull(),
    sourceLabel: text("source_label"),
    status: mergeReviewStatusEnum("status").default("open").notNull(),
    conflictFields: text("conflict_fields").array().default([]).notNull(),
    currentValues: jsonb("current_values")
      .$type<Record<string, string | null>>()
      .default({})
      .notNull(),
    proposedValues: jsonb("proposed_values")
      .$type<Record<string, string | null>>()
      .default({})
      .notNull(),
    resolution: jsonb("resolution")
      .$type<Record<string, string>>()
      .default({})
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("contact_merge_reviews_provider_source_ref_unique").on(
      table.provider,
      table.sourceRef,
    ),
    index("contact_merge_reviews_contact_id_idx").on(table.contactId),
    index("contact_merge_reviews_status_idx").on(table.status),
  ],
);

export const sequenceEnrollments = pgTable(
  "sequence_enrollments",
  {
    id: idColumn(),
    sequenceId: text("sequence_id")
      .notNull()
      .references(() => sequences.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    status: enrollmentStatusEnum("status").default("active").notNull(),
    nextDueAt: timestamp("next_due_at", { withTimezone: true }),
    stopReason: text("stop_reason"),
    ...timestamps,
  },
  (table) => [
    index("sequence_enrollments_sequence_id_idx").on(table.sequenceId),
    index("sequence_enrollments_contact_id_idx").on(table.contactId),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: idColumn(),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    eventName: text("event_name").notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_events_entity_idx").on(table.entityType, table.entityId),
    index("audit_events_actor_idx").on(table.actorUserId),
  ],
);
