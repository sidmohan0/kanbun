ALTER TABLE "import_rows" ADD COLUMN "warnings" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "warning_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "detected_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "unmapped_headers" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "mapping_warnings" text[] DEFAULT '{}' NOT NULL;