CREATE TABLE `account_preferences` (
	`account_id` text PRIMARY KEY NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`custom_theme` text,
	`show_code_block_line_numbers` integer DEFAULT false NOT NULL,
	`font_size` text DEFAULT 'default' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`avatar_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_email` ON `accounts` (`email`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`account_id` text NOT NULL,
	`label` text NOT NULL,
	`prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`scopes` text NOT NULL,
	`last_used_at` text,
	`created_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hash` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_workspace` ON `api_keys` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `auth_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_user_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_identities_provider` ON `auth_identities` (`provider`,`provider_user_id`);--> statement-breakpoint
CREATE INDEX `auth_identities_account` ON `auth_identities` (`account_id`);--> statement-breakpoint
CREATE TABLE `invite_links` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`rotated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`inviter_account_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text,
	`accepted_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `invites_workspace` ON `invites` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE TABLE `magic_links` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `magic_links_email` ON `magic_links` (`email`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`redirect_to` text,
	`code_verifier` text,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`user_agent` text
);
--> statement-breakpoint
CREATE INDEX `sessions_account` ON `sessions` (`account_id`);--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`workspace_id` text NOT NULL,
	`account_id` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` text NOT NULL,
	`removed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_members_pair` ON `workspace_members` (`workspace_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `workspace_members_account` ON `workspace_members` (`account_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`url_key` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`deletion_requested_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_url_key` ON `workspaces` (`url_key`);