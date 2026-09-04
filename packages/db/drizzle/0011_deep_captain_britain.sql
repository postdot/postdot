PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`profile_version_id` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`archived_at` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "channels_profile_version_id_nonblank" CHECK(length(trim("__new_channels"."profile_version_id")) > 0),
	CONSTRAINT "channels_name_nonblank" CHECK(length(trim("__new_channels"."name")) > 0),
	CONSTRAINT "channels_state_valid" CHECK("__new_channels"."state" in ('active', 'archived')),
	CONSTRAINT "channels_archived_timestamp_valid" CHECK(("__new_channels"."state" = 'active' and "__new_channels"."archived_at" is null)
                or ("__new_channels"."state" = 'archived' and "__new_channels"."archived_at" is not null)),
	CONSTRAINT "channels_revision_positive" CHECK("__new_channels"."revision" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_channels`("id", "project_id", "name", "profile_version_id", "state", "archived_at", "revision", "created_at", "updated_at") SELECT "id", "project_id", "name", "profile_version_id", 'active', NULL, 1, "created_at", "updated_at" FROM `channels`;--> statement-breakpoint
DROP TABLE `channels`;--> statement-breakpoint
ALTER TABLE `__new_channels` RENAME TO `channels`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `channels_project_id_id_uidx` ON `channels` (`project_id`,`id`);
