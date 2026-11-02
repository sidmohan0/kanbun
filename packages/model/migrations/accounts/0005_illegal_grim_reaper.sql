CREATE TABLE `google_sheets_connections` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`refresh_token` text NOT NULL,
	`spreadsheet_id` text,
	`projects_enabled` integer DEFAULT false NOT NULL,
	`last_synced_seq` text,
	`last_synced_at` text,
	`error` text
);
