CREATE TABLE `github_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE TABLE `github_observation_cursor` (
	`id` text PRIMARY KEY NOT NULL,
	`last_revision` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `github_repository` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`team_id` text NOT NULL,
	`installation_id` integer NOT NULL,
	`repository_id` integer NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`private` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_repository_team_repository` ON `github_repository` (`team_id`,`repository_id`);--> statement-breakpoint
CREATE INDEX `github_repository_installation` ON `github_repository` (`installation_id`);--> statement-breakpoint
CREATE TABLE `issue_pull_request` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`team_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`issue_incarnation` text NOT NULL,
	`repository_binding_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`state` text NOT NULL,
	`head_ref` text NOT NULL,
	`base_ref` text NOT NULL,
	`head_sha` text NOT NULL,
	`review_status` text NOT NULL,
	`review_head_sha` text,
	`checks_status` text NOT NULL,
	`checks_head_sha` text,
	`checks_url` text,
	`observation_revision` integer NOT NULL,
	`provider_updated_at` text NOT NULL,
	`observed_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_pull_request_association` ON `issue_pull_request` (`issue_id`,`repository_binding_id`,`number`);--> statement-breakpoint
CREATE INDEX `issue_pull_request_issue` ON `issue_pull_request` (`issue_id`);