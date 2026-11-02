CREATE TABLE `slack_issue_reply` (
	`id` text PRIMARY KEY NOT NULL,
	`pending_job_id` text,
	`last_sent_at` text
);
