CREATE TYPE "public"."import_row_status" AS ENUM('created', 'updated', 'flagged');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('processing', 'completed', 'completed_with_warnings', 'failed');--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"import_id" text NOT NULL,
	"row_number" integer NOT NULL,
	"raw_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"normalized_name" text,
	"normalized_email" text,
	"normalized_company" text,
	"normalized_title" text,
	"status" "import_row_status" NOT NULL,
	"warning" text,
	"contact_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" text PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"label" text,
	"status" "import_status" DEFAULT 'processing' NOT NULL,
	"headers" text[] DEFAULT '{}' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"flagged_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "slug" text NOT NULL;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_rows_import_row_number_unique" ON "import_rows" USING btree ("import_id","row_number");--> statement-breakpoint
CREATE INDEX "import_rows_import_id_idx" ON "import_rows" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "import_rows_contact_id_idx" ON "import_rows" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "imports_created_at_idx" ON "imports" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_slug_unique" ON "contacts" USING btree ("slug");