ALTER TABLE `publication_first_comments` ADD `provider_id` text DEFAULT 'bluesky' NOT NULL;--> statement-breakpoint
ALTER TABLE `publication_first_comments` ADD `instance_origin` text;