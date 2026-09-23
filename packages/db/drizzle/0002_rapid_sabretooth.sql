CREATE TABLE `team` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`member_count` integer DEFAULT 0 NOT NULL,
	`organization_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `team_organization_id_idx` ON `team` (`organization_id`);--> statement-breakpoint
CREATE TABLE `team_member` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`membership_key` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_member_membership_key_unique` ON `team_member` (`membership_key`);--> statement-breakpoint
CREATE INDEX `team_member_team_id_idx` ON `team_member` (`team_id`);--> statement-breakpoint
CREATE INDEX `team_member_user_id_idx` ON `team_member` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_member_team_user_uidx` ON `team_member` (`team_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "workspaces_name_nonblank" CHECK(length(trim("workspaces"."name")) > 0),
	CONSTRAINT "workspaces_slug_nonblank" CHECK(length(trim("workspaces"."slug")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_organization_id_uidx` ON `workspaces` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_slug_uidx` ON `workspaces` (`slug`);--> statement-breakpoint
ALTER TABLE `invitation` ADD `team_id` text;--> statement-breakpoint
CREATE INDEX `invitation_team_id_idx` ON `invitation` (`team_id`);--> statement-breakpoint
ALTER TABLE `session` ADD `active_team_id` text;--> statement-breakpoint
ALTER TABLE `instance_state` ADD `default_workspace_id` text REFERENCES workspaces(id);--> statement-breakpoint
ALTER TABLE `projects` ADD `workspace_id` text REFERENCES workspaces(id);