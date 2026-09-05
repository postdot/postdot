CREATE UNIQUE INDEX `audit_events_project_id_id_uidx` ON `audit_events` (`project_id`,`id`);--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`recipient_actor_id` text NOT NULL,
	`kind` text NOT NULL,
	`in_app_enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`recipient_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_preferences_kind_valid" CHECK("notification_preferences"."kind" in ('publication_published', 'publication_failed', 'publication_ambiguous'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_preferences_recipient_kind_uidx` ON `notification_preferences` (`project_id`,`recipient_actor_id`,`kind`);--> statement-breakpoint
CREATE TABLE `notification_projection_cursors` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`projection` text NOT NULL,
	`cursor` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_projection_cursors_projection_nonblank" CHECK(length(trim("notification_projection_cursors"."projection")) > 0),
	CONSTRAINT "notification_projection_cursors_cursor_nonblank" CHECK("notification_projection_cursors"."cursor" is null or length(trim("notification_projection_cursors"."cursor")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_projection_cursors_project_projection_uidx` ON `notification_projection_cursors` (`project_id`,`projection`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`recipient_actor_id` text NOT NULL,
	`source_event_id` text NOT NULL,
	`kind` text NOT NULL,
	`severity` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`read_at` integer,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`recipient_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`source_event_id`) REFERENCES `audit_events`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notifications_kind_valid" CHECK("notifications"."kind" in ('publication_published', 'publication_failed', 'publication_ambiguous')),
	CONSTRAINT "notifications_severity_valid" CHECK("notifications"."severity" in ('success', 'warning', 'error')),
	CONSTRAINT "notifications_subject_type_nonblank" CHECK(length(trim("notifications"."subject_type")) > 0),
	CONSTRAINT "notifications_subject_id_nonblank" CHECK(length(trim("notifications"."subject_id")) > 0),
	CONSTRAINT "notifications_title_nonblank" CHECK(length(trim("notifications"."title")) > 0),
	CONSTRAINT "notifications_body_nonblank" CHECK(length(trim("notifications"."body")) > 0),
	CONSTRAINT "notifications_read_at_valid" CHECK("notifications"."read_at" is null or "notifications"."read_at" >= "notifications"."created_at"),
	CONSTRAINT "notifications_archived_at_valid" CHECK("notifications"."archived_at" is null or "notifications"."archived_at" >= "notifications"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_recipient_source_event_uidx` ON `notifications` (`project_id`,`recipient_actor_id`,`source_event_id`);--> statement-breakpoint
CREATE INDEX `notifications_recipient_inbox_idx` ON `notifications` (`project_id`,`recipient_actor_id`,`archived_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_recipient_unread_idx` ON `notifications` (`project_id`,`recipient_actor_id`,`read_at`,`archived_at`);
