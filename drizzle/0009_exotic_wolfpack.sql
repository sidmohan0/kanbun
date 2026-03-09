CREATE TYPE "public"."outbound_message_status" AS ENUM('draft', 'queued', 'sending', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."sequence_send_mode" AS ENUM('manual_review');--> statement-breakpoint
CREATE TYPE "public"."sequence_step_kind" AS ENUM('email');--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"connected_account_id" text,
	"sequence_id" text,
	"sequence_enrollment_id" text,
	"sequence_step_id" text,
	"provider" "provider",
	"status" "outbound_message_status" DEFAULT 'draft' NOT NULL,
	"subject_template" text,
	"body_template" text,
	"rendered_subject" text NOT NULL,
	"rendered_body" text NOT NULL,
	"final_subject" text NOT NULL,
	"final_body" text NOT NULL,
	"due_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"queued_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"provider_message_id" text,
	"provider_thread_id" text,
	"last_error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequence_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"sequence_id" text NOT NULL,
	"position" integer NOT NULL,
	"kind" "sequence_step_kind" DEFAULT 'email' NOT NULL,
	"title" text NOT NULL,
	"subject_template" text NOT NULL,
	"body_template" text NOT NULL,
	"delay_days" integer DEFAULT 0 NOT NULL,
	"send_mode" "sequence_send_mode" DEFAULT 'manual_review' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD COLUMN "connected_account_id" text;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD COLUMN "current_step_position" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sequences" ADD COLUMN "send_mode" "sequence_send_mode" DEFAULT 'manual_review' NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_sequence_enrollment_id_sequence_enrollments_id_fk" FOREIGN KEY ("sequence_enrollment_id") REFERENCES "public"."sequence_enrollments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_sequence_step_id_sequence_steps_id_fk" FOREIGN KEY ("sequence_step_id") REFERENCES "public"."sequence_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbound_messages_contact_id_idx" ON "outbound_messages" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "outbound_messages_connected_account_id_idx" ON "outbound_messages" USING btree ("connected_account_id");--> statement-breakpoint
CREATE INDEX "outbound_messages_sequence_enrollment_id_idx" ON "outbound_messages" USING btree ("sequence_enrollment_id");--> statement-breakpoint
CREATE INDEX "outbound_messages_status_idx" ON "outbound_messages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "outbound_messages_due_at_idx" ON "outbound_messages" USING btree ("due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_messages_enrollment_step_unique" ON "outbound_messages" USING btree ("sequence_enrollment_id","sequence_step_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sequence_steps_sequence_position_unique" ON "sequence_steps" USING btree ("sequence_id","position");--> statement-breakpoint
CREATE INDEX "sequence_steps_sequence_id_idx" ON "sequence_steps" USING btree ("sequence_id");--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sequence_enrollments_connected_account_id_idx" ON "sequence_enrollments" USING btree ("connected_account_id");