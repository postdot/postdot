CREATE TABLE `publication_composer_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner_actor_id` text NOT NULL,
	`content_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`owner_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publication_composer_drafts_content_object" CHECK(json_valid("publication_composer_drafts"."content_json") and json_type("publication_composer_drafts"."content_json") = 'object'),
	CONSTRAINT "publication_composer_drafts_revision_positive" CHECK("publication_composer_drafts"."revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_composer_drafts_project_actor_uidx` ON `publication_composer_drafts` (`project_id`,`owner_actor_id`);