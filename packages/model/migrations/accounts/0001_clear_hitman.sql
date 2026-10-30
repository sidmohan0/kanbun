ALTER TABLE `invites` ADD `accepted_account_id` text;--> statement-breakpoint
ALTER TABLE `invites` ADD `revoked_at` text;--> statement-breakpoint
ALTER TABLE `workspace_members` ADD `admission_id` text;