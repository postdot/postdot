CREATE TABLE `project_access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`name` text NOT NULL,
	`token_prefix` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`created_by_actor_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`created_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "project_access_tokens_name_nonblank" CHECK(length(trim("project_access_tokens"."name")) > 0),
	CONSTRAINT "project_access_tokens_prefix_nonblank" CHECK(length(trim("project_access_tokens"."token_prefix")) > 0),
	CONSTRAINT "project_access_tokens_hash_nonblank" CHECK(length(trim("project_access_tokens"."token_hash")) > 0),
	CONSTRAINT "project_access_tokens_expiry_valid" CHECK("project_access_tokens"."expires_at" is null or "project_access_tokens"."expires_at" > "project_access_tokens"."created_at"),
	CONSTRAINT "project_access_tokens_revocation_valid" CHECK("project_access_tokens"."revoked_at" is null or "project_access_tokens"."revoked_at" >= "project_access_tokens"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_access_tokens_project_id_id_uidx` ON `project_access_tokens` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_access_tokens_token_hash_uidx` ON `project_access_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `project_access_tokens_project_revoked_idx` ON `project_access_tokens` (`project_id`,`revoked_at`);