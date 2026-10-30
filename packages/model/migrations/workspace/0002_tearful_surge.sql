CREATE TABLE `branch_row` (
	`branch_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`row` text,
	`tombstone` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`branch_id`, `entity_type`, `entity_id`),
	CONSTRAINT "branch_row_payload_check" CHECK(("branch_row"."tombstone" = 1 AND "branch_row"."row" IS NULL) OR ("branch_row"."tombstone" = 0 AND "branch_row"."row" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `branch_row_branch` ON `branch_row` (`branch_id`);--> statement-breakpoint
CREATE TABLE `workspace_branch` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_seq` integer NOT NULL,
	`owner_id` text NOT NULL,
	`owner_type` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`scope` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "workspace_branch_id_not_main" CHECK("workspace_branch"."id" <> 'main'),
	CONSTRAINT "workspace_branch_base_seq_nonnegative" CHECK("workspace_branch"."base_seq" >= 0),
	CONSTRAINT "workspace_branch_owner_type_check" CHECK("owner_type" IN ('user', 'agent', 'integration', 'system')),
	CONSTRAINT "workspace_branch_status_check" CHECK("status" IN ('open', 'merged', 'abandoned', 'conflicted'))
);
--> statement-breakpoint
CREATE INDEX `workspace_branch_owner` ON `workspace_branch` (`owner_user_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_event_log` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` text NOT NULL,
	`txn_id` text NOT NULL,
	`event_index` integer NOT NULL,
	`type` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`team_id` text,
	`scope_user_id` text,
	`payload` text NOT NULL,
	`actor` text NOT NULL,
	`client_id` text,
	`mutation_id` integer,
	`session_id` text,
	`source_ref` text,
	`causation_seq` integer,
	`reason` text,
	`ts` integer NOT NULL,
	CONSTRAINT "event_log_event_index_nonnegative" CHECK("__new_event_log"."event_index" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_event_log`("seq", "branch_id", "txn_id", "event_index", "type", "entity_type", "entity_id", "team_id", "scope_user_id", "payload", "actor", "client_id", "mutation_id", "session_id", "source_ref", "causation_seq", "reason", "ts") SELECT "seq", "branch_id", "txn_id", "event_index", "type", "entity_type", "entity_id", "team_id", "scope_user_id", "payload", "actor", "client_id", "mutation_id", "session_id", "source_ref", "causation_seq", "reason", "ts" FROM `event_log`;--> statement-breakpoint
DROP TABLE `event_log`;--> statement-breakpoint
ALTER TABLE `__new_event_log` RENAME TO `event_log`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `event_log_client_mutation_index` ON `event_log` (`client_id`,`mutation_id`,`event_index`);--> statement-breakpoint
CREATE INDEX `event_log_branch_seq` ON `event_log` (`branch_id`,`seq`);--> statement-breakpoint
CREATE INDEX `event_log_entity` ON `event_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `event_log_team_seq` ON `event_log` (`team_id`,`seq`);--> statement-breakpoint
CREATE INDEX `event_log_txn` ON `event_log` (`txn_id`);--> statement-breakpoint
ALTER TABLE `sync_client` ADD `branch_id` text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_log` ADD `branch_id` text DEFAULT 'main' NOT NULL;--> statement-breakpoint
CREATE INDEX `sync_log_branch_seq` ON `sync_log` (`branch_id`,`seq`);