ALTER TABLE `slack_connections` ADD `unfurls_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `slack_connections` ADD `unfurl_generation` text DEFAULT '' NOT NULL;