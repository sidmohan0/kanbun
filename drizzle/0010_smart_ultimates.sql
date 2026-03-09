CREATE TABLE "reply_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"source_type" text NOT NULL,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sequences" ADD COLUMN "daily_send_cap" integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE "sequences" ADD COLUMN "send_window_end_hour" integer DEFAULT 17 NOT NULL;--> statement-breakpoint
ALTER TABLE "sequences" ADD COLUMN "send_window_start_hour" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "reply_signals" ADD CONSTRAINT "reply_signals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reply_signals_contact_id_idx" ON "reply_signals" USING btree ("contact_id");