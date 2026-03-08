ALTER TABLE "connected_accounts" ADD COLUMN "sync_cursor" text;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD COLUMN "sync_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD COLUMN "last_synced_contact_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "connected_accounts_provider_sync_requested_at_idx" ON "connected_accounts" USING btree ("provider","sync_requested_at");