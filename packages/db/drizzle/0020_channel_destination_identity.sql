ALTER TABLE `channels` ADD `destination_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `channels` ADD `destination_identity_json` text;--> statement-breakpoint
ALTER TABLE `publication_execution_revisions` ADD `destination_snapshot_json` text;--> statement-breakpoint
ALTER TABLE `publications` ADD `confirmed_destination_revision` integer DEFAULT 0 NOT NULL;