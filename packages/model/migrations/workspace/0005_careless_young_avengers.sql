ALTER TABLE `issue` ADD `asserted_state_id` text;--> statement-breakpoint
ALTER TABLE `issue` ADD `derived_state_id` text;
--> statement-breakpoint
UPDATE issue SET derived_state_id = state_id;
