CREATE TABLE `notification_user_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`in_app_enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "notification_user_preferences_user_nonblank" CHECK(length(trim("notification_user_preferences"."user_id")) > 0),
	CONSTRAINT "notification_user_preferences_kind_valid" CHECK("notification_user_preferences"."kind" in ('publication_published', 'publication_failed', 'publication_ambiguous'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_user_preferences_user_kind_uidx` ON `notification_user_preferences` (`user_id`,`kind`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`recipient_user_id` text NOT NULL,
	`recipient_actor_id` text,
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
	CONSTRAINT "notifications_kind_valid" CHECK("__new_notifications"."kind" in ('publication_published', 'publication_failed', 'publication_ambiguous')),
	CONSTRAINT "notifications_severity_valid" CHECK("__new_notifications"."severity" in ('success', 'warning', 'error')),
	CONSTRAINT "notifications_project_actor_scope_valid" CHECK(("__new_notifications"."project_id" is null and "__new_notifications"."recipient_actor_id" is null)
                or ("__new_notifications"."project_id" is not null and "__new_notifications"."recipient_actor_id" is not null)),
	CONSTRAINT "notifications_recipient_user_nonblank" CHECK(length(trim("__new_notifications"."recipient_user_id")) > 0),
	CONSTRAINT "notifications_subject_type_nonblank" CHECK(length(trim("__new_notifications"."subject_type")) > 0),
	CONSTRAINT "notifications_subject_id_nonblank" CHECK(length(trim("__new_notifications"."subject_id")) > 0),
	CONSTRAINT "notifications_title_nonblank" CHECK(length(trim("__new_notifications"."title")) > 0),
	CONSTRAINT "notifications_body_nonblank" CHECK(length(trim("__new_notifications"."body")) > 0),
	CONSTRAINT "notifications_read_at_valid" CHECK("__new_notifications"."read_at" is null or "__new_notifications"."read_at" >= "__new_notifications"."created_at"),
	CONSTRAINT "notifications_archived_at_valid" CHECK("__new_notifications"."archived_at" is null or "__new_notifications"."archived_at" >= "__new_notifications"."created_at")
);
--> statement-breakpoint
-- Every existing notification must resolve to its human actor subject. Keep the
-- migration fail-closed rather than silently dropping rows that cannot be mapped.
INSERT INTO `__new_notifications`("id", "project_id", "recipient_user_id", "recipient_actor_id", "source_event_id", "kind", "severity", "subject_type", "subject_id", "title", "body", "read_at", "archived_at", "created_at")
SELECT notifications."id", notifications."project_id", actors."subject_id", notifications."recipient_actor_id", notifications."source_event_id", notifications."kind", notifications."severity", notifications."subject_type", notifications."subject_id", notifications."title", notifications."body", notifications."read_at", notifications."archived_at", notifications."created_at"
FROM `notifications`
LEFT JOIN `actors`
    ON actors."project_id" = notifications."project_id"
    AND actors."id" = notifications."recipient_actor_id";--> statement-breakpoint
DROP TABLE `notifications`;--> statement-breakpoint
ALTER TABLE `__new_notifications` RENAME TO `notifications`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_user_project_source_event_uidx` ON `notifications` (`recipient_user_id`,`project_id`,`source_event_id`);--> statement-breakpoint
CREATE INDEX `notifications_user_inbox_idx` ON `notifications` (`recipient_user_id`,`project_id`,`archived_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_user_unread_idx` ON `notifications` (`recipient_user_id`,`project_id`,`read_at`,`archived_at`);
