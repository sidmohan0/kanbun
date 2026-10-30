CREATE TABLE `notification_cursor` (
	`id` text PRIMARY KEY NOT NULL,
	`last_event_seq` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `comment` ADD `mentioned_user_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `notification` ADD `team_id` text;--> statement-breakpoint
ALTER TABLE `notification` ADD `source_event_seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `notification` ADD `issue_incarnation` text;--> statement-breakpoint
ALTER TABLE `notification` ADD `recipient_admission_id` text;--> statement-breakpoint
ALTER TABLE `notification` ADD `delivery_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `notification_delivery_key` ON `notification` (`delivery_key`);--> statement-breakpoint
ALTER TABLE `notification_subscription` ADD `scope` text DEFAULT '{"kind":"workspace"}' NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_subscription` ADD `event_types` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_subscription` ADD `actors` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `notification_event_floor` integer DEFAULT 0 NOT NULL;