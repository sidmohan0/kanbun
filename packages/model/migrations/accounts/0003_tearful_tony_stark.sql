CREATE TABLE `github_setups` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`session_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`catalog` text NOT NULL,
	`error` text
);
