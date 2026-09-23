CREATE TABLE `project_team_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`team_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_team_grants_role_valid" CHECK("project_team_grants"."role" in ('owner', 'editor', 'viewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_team_grants_project_team_uidx` ON `project_team_grants` (`project_id`,`team_id`);--> statement-breakpoint
CREATE INDEX `project_team_grants_team_project_idx` ON `project_team_grants` (`team_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `project_user_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_user_grants_role_valid" CHECK("project_user_grants"."role" in ('owner', 'editor', 'viewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_user_grants_project_user_uidx` ON `project_user_grants` (`project_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `project_user_grants_user_project_idx` ON `project_user_grants` (`user_id`,`project_id`);