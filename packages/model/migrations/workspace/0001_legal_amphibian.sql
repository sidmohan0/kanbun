CREATE TABLE `event_log` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` text NOT NULL,
	`txn_id` text NOT NULL,
	`event_index` integer NOT NULL,
	`type` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`team_id` text NOT NULL,
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
	CONSTRAINT "event_log_event_index_nonnegative" CHECK("event_log"."event_index" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_log_client_mutation_index` ON `event_log` (`client_id`,`mutation_id`,`event_index`);--> statement-breakpoint
CREATE INDEX `event_log_branch_seq` ON `event_log` (`branch_id`,`seq`);--> statement-breakpoint
CREATE INDEX `event_log_entity` ON `event_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `event_log_team_seq` ON `event_log` (`team_id`,`seq`);--> statement-breakpoint
CREATE INDEX `event_log_txn` ON `event_log` (`txn_id`);--> statement-breakpoint
ALTER TABLE `issue` ADD `created_seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `issue` ADD `updated_seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_log` ADD `event_seq` integer;--> statement-breakpoint
CREATE INDEX `sync_log_event_seq` ON `sync_log` (`event_seq`);