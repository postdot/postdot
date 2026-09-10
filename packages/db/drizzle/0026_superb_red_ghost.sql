CREATE TABLE `project_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "project_categories_name_nonblank" CHECK(length(trim("project_categories"."name")) > 0),
	CONSTRAINT "project_categories_normalized_name_nonblank" CHECK(length(trim("project_categories"."normalized_name")) > 0),
	CONSTRAINT "project_categories_name_length_valid" CHECK(length("project_categories"."name") <= 120 and length("project_categories"."normalized_name") <= 120),
	CONSTRAINT "project_categories_state_valid" CHECK("project_categories"."state" in ('active', 'archived')),
	CONSTRAINT "project_categories_archived_timestamp_valid" CHECK(("project_categories"."state" = 'active' and "project_categories"."archived_at" is null)
                or ("project_categories"."state" = 'archived' and "project_categories"."archived_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_categories_normalized_name_uidx` ON `project_categories` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `project_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_tags_name_nonblank" CHECK(length(trim("project_tags"."name")) > 0),
	CONSTRAINT "project_tags_normalized_name_nonblank" CHECK(length(trim("project_tags"."normalized_name")) > 0),
	CONSTRAINT "project_tags_name_length_valid" CHECK(length("project_tags"."name") <= 120 and length("project_tags"."normalized_name") <= 120),
	CONSTRAINT "project_tags_state_valid" CHECK("project_tags"."state" in ('active', 'archived')),
	CONSTRAINT "project_tags_archived_timestamp_valid" CHECK(("project_tags"."state" = 'active' and "project_tags"."archived_at" is null)
                or ("project_tags"."state" = 'archived' and "project_tags"."archived_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_tags_project_id_id_uidx` ON `project_tags` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_tags_project_id_normalized_name_uidx` ON `project_tags` (`project_id`,`normalized_name`);--> statement-breakpoint
CREATE TABLE `publication_tags` (
	`project_id` text NOT NULL,
	`publication_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`project_id`, `publication_id`, `tag_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`publication_id`) REFERENCES `publications`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`tag_id`) REFERENCES `project_tags`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publication_tags_publication_id_nonblank" CHECK(length(trim("publication_tags"."publication_id")) > 0),
	CONSTRAINT "publication_tags_tag_id_nonblank" CHECK(length(trim("publication_tags"."tag_id")) > 0)
);
--> statement-breakpoint
CREATE INDEX `publication_tags_project_publication_idx` ON `publication_tags` (`project_id`,`publication_id`);--> statement-breakpoint
CREATE INDEX `publication_tags_project_tag_idx` ON `publication_tags` (`project_id`,`tag_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `primary_category_id` text REFERENCES project_categories(id);