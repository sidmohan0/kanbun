CREATE TABLE `slack_connections` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`team_name` text NOT NULL,
	`bot_user_id` text NOT NULL,
	`token_ciphertext` text NOT NULL,
	`scopes` text NOT NULL,
	`connected_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slack_connections_team` ON `slack_connections` (`team_id`);