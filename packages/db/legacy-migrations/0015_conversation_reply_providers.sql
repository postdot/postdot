ALTER TABLE `publication_comment_replies` RENAME COLUMN "account_did" TO "account_id";--> statement-breakpoint
DROP INDEX `publication_comment_replies_record`;--> statement-breakpoint
ALTER TABLE `publication_comment_replies` ADD `provider_id` text DEFAULT 'bluesky' NOT NULL;--> statement-breakpoint
ALTER TABLE `publication_comment_replies` ADD `instance_origin` text;--> statement-breakpoint
CREATE UNIQUE INDEX `publication_comment_replies_record` ON `publication_comment_replies` (`provider_id`,`account_id`,`record_key`);