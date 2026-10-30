CREATE TABLE `agent` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`name` text NOT NULL,
	`description` text,
	`avatar_url` text,
	`owner_id` text NOT NULL,
	`mode` text DEFAULT 'propose' NOT NULL,
	`scopes` text NOT NULL,
	`rate_budget` integer DEFAULT 600 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_active_at` text,
	CONSTRAINT "agent_mode_check" CHECK("mode" IN ('propose', 'commit'))
);
--> statement-breakpoint
CREATE INDEX `agent_owner` ON `agent` (`owner_id`);--> statement-breakpoint
CREATE TABLE `attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`team_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`creator_id` text,
	`title` text NOT NULL,
	`subtitle` text,
	`url` text NOT NULL,
	`source_type` text,
	`metadata` text NOT NULL,
	`group_by_source` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attachment_issue` ON `attachment` (`issue_id`);--> statement-breakpoint
CREATE INDEX `attachment_team` ON `attachment` (`team_id`);--> statement-breakpoint
CREATE TABLE `comment` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`team_id` text,
	`body` text NOT NULL,
	`body_data` text,
	`user_id` text,
	`agent_id` text,
	`parent_id` text,
	`issue_id` text,
	`project_update_id` text,
	`initiative_update_id` text,
	`document_content_id` text,
	`anchor` text,
	`quoted_text` text,
	`edited_at` text,
	`resolved_at` text,
	`resolving_user_id` text,
	`resolving_comment_id` text,
	CONSTRAINT "comment_owner_check" CHECK((("issue_id" IS NOT NULL) + ("project_update_id" IS NOT NULL) + ("initiative_update_id" IS NOT NULL) + ("document_content_id" IS NOT NULL)) = 1),
	CONSTRAINT "comment_author_check" CHECK(("user_id" IS NOT NULL) + ("agent_id" IS NOT NULL) = 1)
);
--> statement-breakpoint
CREATE INDEX `comment_issue` ON `comment` (`issue_id`);--> statement-breakpoint
CREATE INDEX `comment_parent` ON `comment` (`parent_id`);--> statement-breakpoint
CREATE INDEX `comment_team` ON `comment` (`team_id`);--> statement-breakpoint
CREATE TABLE `custom_view` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`name` text NOT NULL,
	`slug_id` text NOT NULL,
	`description` text,
	`icon` text,
	`color` text,
	`model_name` text DEFAULT 'issue' NOT NULL,
	`filter_data` text NOT NULL,
	`project_filter_data` text,
	`shared` integer DEFAULT false NOT NULL,
	`owner_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`updated_by_id` text,
	`team_id` text
);
--> statement-breakpoint
CREATE INDEX `custom_view_owner` ON `custom_view` (`owner_id`);--> statement-breakpoint
CREATE INDEX `custom_view_team` ON `custom_view` (`team_id`);--> statement-breakpoint
CREATE TABLE `cycle` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`team_id` text NOT NULL,
	`number` integer NOT NULL,
	`name` text,
	`description` text,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`completed_at` text,
	`scope_history` text NOT NULL,
	`issue_count_history` text NOT NULL,
	`completed_issue_count_history` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cycle_team_number` ON `cycle` (`team_id`,`number`);--> statement-breakpoint
CREATE TABLE `document_content` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`issue_id` text,
	`document_id` text,
	`project_id` text,
	`initiative_id` text,
	`project_milestone_id` text,
	`comment_id` text,
	`content` text,
	`content_state` text,
	`restored_at` text
);
--> statement-breakpoint
CREATE INDEX `document_content_issue` ON `document_content` (`issue_id`);--> statement-breakpoint
CREATE INDEX `document_content_document` ON `document_content` (`document_id`);--> statement-breakpoint
CREATE TABLE `draft` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`team_id` text,
	`issue_id` text,
	`parent_comment_id` text,
	`project_id` text,
	`initiative_id` text,
	`document_id` text,
	`data` text NOT NULL,
	`was_local_draft` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `draft_user` ON `draft` (`user_id`);--> statement-breakpoint
CREATE TABLE `favorite` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`owner_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`sort_order` text NOT NULL,
	`folder_name` text,
	`parent_id` text,
	`issue_id` text,
	`project_id` text,
	`document_id` text,
	`custom_view_id` text,
	`cycle_id` text,
	`label_id` text,
	`initiative_id` text,
	`customer_id` text,
	`team_id` text,
	`predefined_view_type` text,
	`predefined_view_team_id` text
);
--> statement-breakpoint
CREATE INDEX `favorite_owner` ON `favorite` (`owner_id`);--> statement-breakpoint
CREATE TABLE `issue` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`team_id` text NOT NULL,
	`number` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`description_content_id` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`priority_sort_order` text NOT NULL,
	`estimate` real,
	`due_date` text,
	`sort_order` text NOT NULL,
	`board_order` text NOT NULL,
	`sub_issue_sort_order` text,
	`state_id` text NOT NULL,
	`assignee_id` text,
	`creator_id` text,
	`delegate_id` text,
	`parent_id` text,
	`project_id` text,
	`project_milestone_id` text,
	`cycle_id` text,
	`source_comment_id` text,
	`last_applied_template_id` text,
	`started_at` text,
	`completed_at` text,
	`canceled_at` text,
	`triaged_at` text,
	`started_triage_at` text,
	`added_to_cycle_at` text,
	`added_to_project_at` text,
	`added_to_team_at` text,
	`auto_archived_at` text,
	`auto_closed_at` text,
	`snoozed_by_id` text,
	`snoozed_until_at` text,
	`sla_type` text,
	`sla_started_at` text,
	`sla_medium_risk_at` text,
	`sla_high_risk_at` text,
	`sla_breaches_at` text,
	`trashed` integer DEFAULT false NOT NULL,
	CONSTRAINT "issue_priority_check" CHECK("priority" IN (0, 1, 2, 3, 4))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_team_number` ON `issue` (`team_id`,`number`);--> statement-breakpoint
CREATE INDEX `issue_team_state` ON `issue` (`team_id`,`state_id`);--> statement-breakpoint
CREATE INDEX `issue_assignee` ON `issue` (`assignee_id`);--> statement-breakpoint
CREATE INDEX `issue_parent` ON `issue` (`parent_id`);--> statement-breakpoint
CREATE INDEX `issue_project` ON `issue` (`project_id`);--> statement-breakpoint
CREATE INDEX `issue_cycle` ON `issue` (`cycle_id`);--> statement-breakpoint
CREATE TABLE `issue_label` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`team_id` text,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`description` text,
	`is_group` integer DEFAULT false NOT NULL,
	`group_type` text,
	`parent_id` text,
	`creator_id` text,
	`retired_at` text,
	`last_applied_at` text
);
--> statement-breakpoint
CREATE INDEX `issue_label_team` ON `issue_label` (`team_id`);--> statement-breakpoint
CREATE INDEX `issue_label_parent` ON `issue_label` (`parent_id`);--> statement-breakpoint
CREATE TABLE `issue_label_link` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`team_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`label_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_label_link_pair` ON `issue_label_link` (`issue_id`,`label_id`);--> statement-breakpoint
CREATE INDEX `issue_label_link_label` ON `issue_label_link` (`label_id`);--> statement-breakpoint
CREATE INDEX `issue_label_link_team` ON `issue_label_link` (`team_id`);--> statement-breakpoint
CREATE TABLE `issue_relation` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`team_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`related_issue_id` text NOT NULL,
	`type` text NOT NULL,
	CONSTRAINT "issue_relation_type_check" CHECK("type" IN ('blocks', 'duplicate', 'related', 'similar'))
);
--> statement-breakpoint
CREATE INDEX `issue_relation_issue` ON `issue_relation` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_relation_related` ON `issue_relation` (`related_issue_id`);--> statement-breakpoint
CREATE INDEX `issue_relation_team` ON `issue_relation` (`team_id`);--> statement-breakpoint
CREATE TABLE `issue_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`team_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`user_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_subscription_pair` ON `issue_subscription` (`issue_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `issue_subscription_user` ON `issue_subscription` (`user_id`);--> statement-breakpoint
CREATE INDEX `issue_subscription_team` ON `issue_subscription` (`team_id`);--> statement-breakpoint
CREATE TABLE `notification` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`user_id` text NOT NULL,
	`actor_id` text,
	`type` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`subtitle` text,
	`grouping_key` text NOT NULL,
	`grouping_priority` real DEFAULT 0 NOT NULL,
	`read_at` text,
	`emailed_at` text,
	`snoozed_until_at` text,
	`unsnoozed_at` text,
	`issue_id` text,
	`comment_id` text,
	`project_id` text,
	`project_update_id` text,
	`initiative_id` text,
	`initiative_update_id` text,
	`document_id` text,
	`customer_need_id` text
);
--> statement-breakpoint
CREATE INDEX `notification_user` ON `notification` (`user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `notification_issue` ON `notification` (`issue_id`);--> statement-breakpoint
CREATE TABLE `notification_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`subscriber_id` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`context_view_type` text,
	`team_id` text,
	`project_id` text,
	`initiative_id` text,
	`cycle_id` text,
	`label_id` text,
	`custom_view_id` text,
	`customer_id` text,
	`user_id` text
);
--> statement-breakpoint
CREATE INDEX `notification_subscription_subscriber` ON `notification_subscription` (`subscriber_id`);--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`name` text NOT NULL,
	`url_key` text NOT NULL,
	`logo_url` text,
	`git_branch_format` text DEFAULT '{username}/{issueIdentifier}-{issueTitle}' NOT NULL,
	`fiscal_year_start_month` integer DEFAULT 1 NOT NULL,
	`initiatives_enabled` integer DEFAULT true NOT NULL,
	`customers_enabled` integer DEFAULT false NOT NULL,
	`project_update_reminders_day` text DEFAULT 'Friday' NOT NULL,
	`project_update_reminders_hour` integer DEFAULT 14 NOT NULL,
	`allowed_auth_services` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`name` text NOT NULL,
	`slug_id` text NOT NULL,
	`description` text,
	`content_id` text,
	`icon` text,
	`color` text NOT NULL,
	`status_id` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`priority_sort_order` text NOT NULL,
	`sort_order` text NOT NULL,
	`lead_id` text,
	`lead_team_id` text,
	`creator_id` text,
	`start_date` text,
	`start_date_resolution` text,
	`target_date` text,
	`target_date_resolution` text,
	`started_at` text,
	`completed_at` text,
	`canceled_at` text,
	`health` text,
	`health_updated_at` text,
	`trashed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_status_idx` ON `project` (`status_id`);--> statement-breakpoint
CREATE INDEX `project_lead` ON `project` (`lead_id`);--> statement-breakpoint
CREATE TABLE `project_milestone` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`target_date` text,
	`sort_order` text NOT NULL,
	`status` text DEFAULT 'unstarted' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_milestone_project` ON `project_milestone` (`project_id`);--> statement-breakpoint
CREATE TABLE `project_status` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`team_id` text,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`description` text,
	`type` text NOT NULL,
	`position` real NOT NULL,
	`indefinite` integer DEFAULT false NOT NULL,
	`inherited_from_id` text
);
--> statement-breakpoint
CREATE TABLE `project_team` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`project_id` text NOT NULL,
	`team_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_team_pair` ON `project_team` (`project_id`,`team_id`);--> statement-breakpoint
CREATE TABLE `reaction` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`team_id` text,
	`emoji` text NOT NULL,
	`user_id` text NOT NULL,
	`issue_id` text,
	`comment_id` text,
	`project_update_id` text,
	`initiative_update_id` text,
	CONSTRAINT "reaction_owner_check" CHECK((("issue_id" IS NOT NULL) + ("project_update_id" IS NOT NULL) + ("initiative_update_id" IS NOT NULL)) = 1)
);
--> statement-breakpoint
CREATE INDEX `reaction_issue` ON `reaction` (`issue_id`);--> statement-breakpoint
CREATE INDEX `reaction_comment` ON `reaction` (`comment_id`);--> statement-breakpoint
CREATE INDEX `reaction_team` ON `reaction` (`team_id`);--> statement-breakpoint
CREATE TABLE `scheduled_job` (
	`id` text PRIMARY KEY NOT NULL,
	`fire_at` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`dedup_key` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scheduled_job_fire_at` ON `scheduled_job` (`fire_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_job_dedup` ON `scheduled_job` (`dedup_key`);--> statement-breakpoint
CREATE TABLE `sync_client` (
	`client_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`last_mutation_id` integer DEFAULT 0 NOT NULL,
	`last_seen_at` text NOT NULL,
	`visible_teams` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_log` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`model` text NOT NULL,
	`row_id` text NOT NULL,
	`op` text NOT NULL,
	`patch` text,
	`prev` text,
	`actor_id` text,
	`actor_type` text DEFAULT 'user' NOT NULL,
	`client_id` text,
	`mutation_id` integer,
	`txn_id` text NOT NULL,
	`causation_seq` integer,
	`reason` text,
	`team_id` text,
	`prev_team_id` text,
	`scope_user_id` text,
	`ts` text NOT NULL,
	CONSTRAINT "sync_log_op_check" CHECK("op" IN ('upsert', 'delete')),
	CONSTRAINT "sync_log_actor_type_check" CHECK("actor_type" IN ('user', 'agent', 'integration', 'system'))
);
--> statement-breakpoint
CREATE INDEX `sync_log_model_row` ON `sync_log` (`model`,`row_id`);--> statement-breakpoint
CREATE INDEX `sync_log_team` ON `sync_log` (`team_id`);--> statement-breakpoint
CREATE INDEX `sync_log_prev_team` ON `sync_log` (`prev_team_id`);--> statement-breakpoint
CREATE INDEX `sync_log_txn` ON `sync_log` (`txn_id`);--> statement-breakpoint
CREATE INDEX `sync_log_actor` ON `sync_log` (`actor_type`,`actor_id`);--> statement-breakpoint
CREATE TABLE `team` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`name` text NOT NULL,
	`key` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`icon` text,
	`color` text,
	`timezone` text DEFAULT 'Etc/UTC' NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`parent_id` text,
	`retired_at` text,
	`cycles_enabled` integer DEFAULT false NOT NULL,
	`cycle_duration` integer DEFAULT 2 NOT NULL,
	`cycle_cooldown_time` integer DEFAULT 0 NOT NULL,
	`cycle_start_day` integer DEFAULT 1 NOT NULL,
	`cycle_lock_to_active` integer DEFAULT false NOT NULL,
	`cycle_issue_auto_assign_started` integer DEFAULT true NOT NULL,
	`cycle_issue_auto_assign_completed` integer DEFAULT true NOT NULL,
	`upcoming_cycle_count` integer DEFAULT 2 NOT NULL,
	`triage_enabled` integer DEFAULT false NOT NULL,
	`require_priority_to_leave_triage` integer DEFAULT false NOT NULL,
	`issue_estimation_type` text DEFAULT 'notUsed' NOT NULL,
	`issue_estimation_allow_zero` integer DEFAULT true NOT NULL,
	`issue_estimation_extended` integer DEFAULT false NOT NULL,
	`default_issue_estimate` real DEFAULT 0 NOT NULL,
	`auto_archive_period` integer DEFAULT 6 NOT NULL,
	`auto_close_period` integer,
	`auto_close_state_id` text,
	`auto_close_parent_issues` integer DEFAULT false NOT NULL,
	`auto_close_child_issues` integer DEFAULT false NOT NULL,
	`default_issue_state_id` text,
	`triage_issue_state_id` text,
	`inherit_workflow_statuses` integer DEFAULT false NOT NULL,
	`inherit_project_statuses` integer DEFAULT true NOT NULL,
	`set_issue_sort_order_on_state_change` text DEFAULT 'bottom' NOT NULL,
	`issue_counter` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "team_visibility_check" CHECK("visibility" IN ('public', 'private'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_key` ON `team` (`key`);--> statement-breakpoint
CREATE TABLE `team_membership` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`owner` integer DEFAULT false NOT NULL,
	`sort_order` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_membership_team_user` ON `team_membership` (`team_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `team_membership_user` ON `team_membership` (`user_id`);--> statement-breakpoint
CREATE TABLE `template` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`team_id` text,
	`creator_id` text,
	`last_updated_by_id` text,
	`name` text NOT NULL,
	`description` text,
	`icon` text,
	`color` text,
	`type` text NOT NULL,
	`template_data` text NOT NULL,
	`sort_order` text NOT NULL,
	`last_applied_at` text
);
--> statement-breakpoint
CREATE INDEX `template_team` ON `template` (`team_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text NOT NULL,
	`avatar_url` text,
	`avatar_background_color` text NOT NULL,
	`initials` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`guest` integer DEFAULT false NOT NULL,
	`timezone` text,
	`description` text,
	`status_emoji` text,
	`status_label` text,
	`status_until_at` text,
	`last_seen` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`user_id` text NOT NULL,
	`notification_category_preferences` text NOT NULL,
	`notification_channel_preferences` text NOT NULL,
	`auto_assign_to_self` integer DEFAULT false NOT NULL,
	`sidebar` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `view_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`type` text NOT NULL,
	`user_id` text,
	`view_type` text NOT NULL,
	`custom_view_id` text,
	`team_id` text,
	`project_id` text,
	`cycle_id` text,
	`preferences` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `view_preferences_user` ON `view_preferences` (`user_id`);--> statement-breakpoint
CREATE INDEX `view_preferences_view` ON `view_preferences` (`view_type`,`custom_view_id`,`team_id`);--> statement-breakpoint
CREATE TABLE `workflow_state` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`description` text,
	`type` text NOT NULL,
	`position` real NOT NULL,
	`inherited_from_id` text,
	CONSTRAINT "workflow_state_type_check" CHECK("type" IN ('triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'))
);
--> statement-breakpoint
CREATE INDEX `workflow_state_team` ON `workflow_state` (`team_id`);