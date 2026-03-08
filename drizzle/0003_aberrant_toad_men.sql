CREATE TYPE "public"."import_row_action" AS ENUM('create', 'update', 'flag');--> statement-breakpoint
ALTER TYPE "public"."import_row_status" ADD VALUE 'pending' BEFORE 'created';--> statement-breakpoint
ALTER TYPE "public"."import_status" ADD VALUE 'draft' BEFORE 'processing';--> statement-breakpoint
ALTER TABLE "import_rows" ADD COLUMN "proposed_action" "import_row_action" NOT NULL;