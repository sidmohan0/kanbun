CREATE TYPE "public"."merge_review_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TABLE "contact_merge_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"connected_account_id" text,
	"provider" "provider" NOT NULL,
	"source_ref" text NOT NULL,
	"source_label" text,
	"status" "merge_review_status" DEFAULT 'open' NOT NULL,
	"conflict_fields" text[] DEFAULT '{}' NOT NULL,
	"current_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"proposed_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolution" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_merge_reviews" ADD CONSTRAINT "contact_merge_reviews_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merge_reviews" ADD CONSTRAINT "contact_merge_reviews_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_merge_reviews_provider_source_ref_unique" ON "contact_merge_reviews" USING btree ("provider","source_ref");--> statement-breakpoint
CREATE INDEX "contact_merge_reviews_contact_id_idx" ON "contact_merge_reviews" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_merge_reviews_status_idx" ON "contact_merge_reviews" USING btree ("status");