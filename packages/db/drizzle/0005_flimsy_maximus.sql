PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`time_zone` text DEFAULT 'UTC' NOT NULL,
	`workspace_id` text,
	`primary_category_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`primary_category_id`) REFERENCES `project_categories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "projects_name_nonblank" CHECK(length(trim("__new_projects"."name")) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_projects`("id", "name", "time_zone", "workspace_id", "primary_category_id", "created_at", "updated_at") SELECT "id", "name", "time_zone", "workspace_id", "primary_category_id", "created_at", "updated_at" FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
PRAGMA foreign_keys=ON;