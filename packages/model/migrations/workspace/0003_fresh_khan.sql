CREATE TABLE `branch_merge` (
	`branch_id` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`actor_id` text NOT NULL,
	`request` text NOT NULL,
	`result` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `branch_merge_id` ON `branch_merge` (`id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workspace_branch` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_seq` integer NOT NULL,
	`base_sync_seq` integer,
	`owner_id` text NOT NULL,
	`owner_type` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`scope` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "workspace_branch_id_not_main" CHECK("__new_workspace_branch"."id" <> 'main'),
	CONSTRAINT "workspace_branch_base_seq_nonnegative" CHECK("__new_workspace_branch"."base_seq" >= 0),
	CONSTRAINT "workspace_branch_base_sync_seq_nonnegative" CHECK("__new_workspace_branch"."base_sync_seq" IS NULL OR "__new_workspace_branch"."base_sync_seq" >= 0),
	CONSTRAINT "workspace_branch_owner_type_check" CHECK("owner_type" IN ('user', 'agent', 'integration', 'system')),
	CONSTRAINT "workspace_branch_status_check" CHECK("status" IN ('open', 'merged', 'abandoned', 'conflicted'))
);
--> statement-breakpoint
-- Older branches have no patch baseline; keep it unknown rather than guessing from current state.
INSERT INTO `__new_workspace_branch`("id", "name", "base_seq", "base_sync_seq", "owner_id", "owner_type", "owner_user_id", "status", "scope", "created_at") SELECT "id", "name", "base_seq", NULL, "owner_id", "owner_type", "owner_user_id", "status", "scope", "created_at" FROM `workspace_branch`;--> statement-breakpoint
DROP TABLE `workspace_branch`;--> statement-breakpoint
ALTER TABLE `__new_workspace_branch` RENAME TO `workspace_branch`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `workspace_branch_owner` ON `workspace_branch` (`owner_user_id`);
