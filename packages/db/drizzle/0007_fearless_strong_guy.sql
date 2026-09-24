ALTER TABLE `media_assets` ADD `deletion_restore_state` text;--> statement-breakpoint
ALTER TABLE `media_assets` ADD `deletion_restore_failure_code` text;--> statement-breakpoint
ALTER TABLE `media_assets` ADD `deletion_restore_failure_message` text;--> statement-breakpoint
CREATE INDEX `media_assets_project_trash_idx` ON `media_assets` (`project_id`,`deletion_requested_at`) WHERE "media_assets"."state" = 'deletion_requested';--> statement-breakpoint
ALTER TABLE `media_representations` ADD `deletion_restore_state` text;--> statement-breakpoint
ALTER TABLE `media_representations` ADD `deletion_restore_failure_code` text;--> statement-breakpoint
ALTER TABLE `media_representations` ADD `deletion_restore_failure_message` text;