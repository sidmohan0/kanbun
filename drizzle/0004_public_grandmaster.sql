ALTER TYPE "public"."import_row_action" ADD VALUE 'skip';--> statement-breakpoint
ALTER TYPE "public"."import_row_status" ADD VALUE 'skipped';--> statement-breakpoint
ALTER TABLE "import_rows" ADD COLUMN "override_name" text;--> statement-breakpoint
ALTER TABLE "import_rows" ADD COLUMN "override_email" text;--> statement-breakpoint
ALTER TABLE "import_rows" ADD COLUMN "override_company" text;--> statement-breakpoint
ALTER TABLE "import_rows" ADD COLUMN "override_title" text;--> statement-breakpoint
ALTER TABLE "import_rows" ADD COLUMN "override_action" "import_row_action";--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "file_hash" text;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "skipped_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "imports" SET "file_hash" = md5("file_name" || ':' || "id") WHERE "file_hash" IS NULL;--> statement-breakpoint
ALTER TABLE "imports" ALTER COLUMN "file_hash" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "imports_file_hash_unique" ON "imports" USING btree ("file_hash");
