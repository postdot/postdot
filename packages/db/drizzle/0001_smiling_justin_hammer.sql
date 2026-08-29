CREATE TABLE `actors` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_id` text,
	`display_name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "actors_kind_valid" CHECK("actors"."kind" in ('human', 'agent', 'api_token', 'system')),
	CONSTRAINT "actors_display_name_nonblank" CHECK(length(trim("actors"."display_name")) > 0),
	CONSTRAINT "actors_subject_id_nonblank" CHECK("actors"."subject_id" is null or length(trim("actors"."subject_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `actors_project_id_id_uidx` ON `actors` (`project_id`,`id`);--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "channels_name_nonblank" CHECK(length(trim("channels"."name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channels_project_id_id_uidx` ON `channels` (`project_id`,`id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`publication_id` text NOT NULL,
	`state` text NOT NULL,
	`run_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`error_message` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`publication_id`) REFERENCES `publications`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "jobs_state_valid" CHECK("jobs"."state" in ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "jobs_attempts_nonnegative" CHECK("jobs"."attempts" >= 0),
	CONSTRAINT "jobs_running_has_started" CHECK("jobs"."state" <> 'running' or ("jobs"."started_at" is not null and "jobs"."completed_at" is null and "jobs"."error_message" is null)),
	CONSTRAINT "jobs_pending_is_clean" CHECK("jobs"."state" <> 'pending' or ("jobs"."started_at" is null and "jobs"."completed_at" is null and "jobs"."error_message" is null)),
	CONSTRAINT "jobs_terminal_has_completed" CHECK("jobs"."state" not in ('succeeded', 'failed', 'cancelled') or "jobs"."completed_at" is not null),
	CONSTRAINT "jobs_failed_has_error" CHECK("jobs"."state" <> 'failed' or ("jobs"."error_message" is not null and length(trim("jobs"."error_message")) > 0)),
	CONSTRAINT "jobs_completed_attempt_has_started" CHECK("jobs"."state" not in ('succeeded', 'failed') or "jobs"."started_at" is not null)
);
--> statement-breakpoint
CREATE INDEX `jobs_project_id_publication_id_idx` ON `jobs` (`project_id`,`publication_id`);--> statement-breakpoint
CREATE INDEX `jobs_state_run_at_idx` ON `jobs` (`state`,`run_at`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text,
	`content` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`created_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "posts_title_nonblank" CHECK("posts"."title" is null or length(trim("posts"."title")) > 0),
	CONSTRAINT "posts_content_nonblank" CHECK(length(trim("posts"."content")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `posts_project_id_id_uidx` ON `posts` (`project_id`,`id`);--> statement-breakpoint
CREATE INDEX `posts_project_id_created_by_actor_id_idx` ON `posts` (`project_id`,`created_by_actor_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "projects_name_nonblank" CHECK(length(trim("projects"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE `publications` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`post_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`content` text NOT NULL,
	`state` text NOT NULL,
	`scheduled_at` integer,
	`published_at` integer,
	`external_id` text,
	`external_url` text,
	`error_message` text,
	`created_by_actor_id` text NOT NULL,
	`scheduled_by_actor_id` text,
	`state_changed_by_actor_id` text NOT NULL,
	`published_by_actor_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`post_id`) REFERENCES `posts`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`channel_id`) REFERENCES `channels`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`created_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`scheduled_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`state_changed_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`published_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publications_content_nonblank" CHECK(length(trim("publications"."content")) > 0),
	CONSTRAINT "publications_state_valid" CHECK("publications"."state" in ('draft', 'scheduled', 'ready', 'publishing', 'published', 'failed', 'ambiguous', 'cancelled')),
	CONSTRAINT "publications_schedule_consistent" CHECK(("publications"."scheduled_at" is null and "publications"."scheduled_by_actor_id" is null) or ("publications"."scheduled_at" is not null and "publications"."scheduled_by_actor_id" is not null)),
	CONSTRAINT "publications_scheduled_state_has_time" CHECK("publications"."state" <> 'scheduled' or "publications"."scheduled_at" is not null),
	CONSTRAINT "publications_published_state_complete" CHECK("publications"."state" <> 'published' or ("publications"."published_at" is not null and "publications"."published_by_actor_id" is not null)),
	CONSTRAINT "publications_unpublished_state_has_no_result" CHECK("publications"."state" = 'published' or ("publications"."published_at" is null and "publications"."published_by_actor_id" is null)),
	CONSTRAINT "publications_failure_has_error" CHECK("publications"."state" not in ('failed', 'ambiguous') or ("publications"."error_message" is not null and length(trim("publications"."error_message")) > 0)),
	CONSTRAINT "publications_nonfailure_has_no_error" CHECK("publications"."state" in ('failed', 'ambiguous') or "publications"."error_message" is null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publications_project_id_id_uidx` ON `publications` (`project_id`,`id`);--> statement-breakpoint
CREATE INDEX `publications_project_id_post_id_idx` ON `publications` (`project_id`,`post_id`);--> statement-breakpoint
CREATE INDEX `publications_project_id_channel_id_idx` ON `publications` (`project_id`,`channel_id`);--> statement-breakpoint
CREATE INDEX `publications_state_scheduled_at_idx` ON `publications` (`state`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `publications_project_id_created_by_actor_id_idx` ON `publications` (`project_id`,`created_by_actor_id`);--> statement-breakpoint
CREATE INDEX `publications_project_id_scheduled_by_actor_id_idx` ON `publications` (`project_id`,`scheduled_by_actor_id`);--> statement-breakpoint
CREATE INDEX `publications_project_id_state_changed_by_actor_id_idx` ON `publications` (`project_id`,`state_changed_by_actor_id`);--> statement-breakpoint
CREATE INDEX `publications_project_id_published_by_actor_id_idx` ON `publications` (`project_id`,`published_by_actor_id`);--> statement-breakpoint
CREATE TABLE `publishers` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`channel_id`) REFERENCES `channels`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "publishers_kind_nonblank" CHECK(length(trim("publishers"."kind")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publishers_project_id_id_uidx` ON `publishers` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `publishers_project_id_channel_id_uidx` ON `publishers` (`project_id`,`channel_id`);
