ALTER TABLE `magic_links` ADD `nonce_hash` text;--> statement-breakpoint
ALTER TABLE `magic_links` ADD `claim_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `magic_links_claim` ON `magic_links` (`claim_hash`);