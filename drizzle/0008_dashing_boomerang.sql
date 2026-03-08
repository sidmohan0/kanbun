CREATE TYPE "public"."task_mirror_status" AS ENUM('not_mirrored', 'queued', 'synced', 'degraded');--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "todoist_item_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "todoist_sync_status" "task_mirror_status" DEFAULT 'not_mirrored' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "todoist_sync_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "todoist_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "todoist_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "todoist_last_error" text;--> statement-breakpoint
CREATE INDEX "tasks_todoist_sync_requested_at_idx" ON "tasks" USING btree ("todoist_sync_requested_at");