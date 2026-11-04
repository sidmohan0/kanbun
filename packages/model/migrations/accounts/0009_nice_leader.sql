CREATE TABLE `integration_app_credentials` (
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`credentials_ciphertext` text NOT NULL,
	`configured_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`revision` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_app_credentials_workspace_provider` ON `integration_app_credentials` (`workspace_id`,`provider`);