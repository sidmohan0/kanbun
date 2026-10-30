ALTER TABLE `document_content` ADD `team_id` text;
--> statement-breakpoint
UPDATE document_content SET team_id = (SELECT team_id FROM issue WHERE issue.id = document_content.issue_id) WHERE issue_id IS NOT NULL;
--> statement-breakpoint
UPDATE sync_log SET team_id = (SELECT team_id FROM document_content WHERE document_content.id = sync_log.row_id) WHERE model = 'documentContent' AND row_id IN (SELECT id FROM document_content WHERE issue_id IS NOT NULL);
