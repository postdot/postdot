CREATE TABLE `notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`destination_id` text NOT NULL,
	`source_event_id` text NOT NULL,
	`kind` text NOT NULL,
	`severity` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`lease_token` text,
	`lease_expires_at` integer,
	`effect_started_at` integer,
	`delivered_at` integer,
	`failed_at` integer,
	`ambiguous_at` integer,
	`external_id` text,
	`last_error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`destination_id`) REFERENCES `notification_destinations`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`source_event_id`) REFERENCES `audit_events`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_deliveries_kind_valid" CHECK("notification_deliveries"."kind" in ('publication_published', 'publication_failed', 'publication_ambiguous')),
	CONSTRAINT "notification_deliveries_severity_valid" CHECK("notification_deliveries"."severity" in ('success', 'warning', 'error')),
	CONSTRAINT "notification_deliveries_subject_type_nonblank" CHECK(length(trim("notification_deliveries"."subject_type")) > 0),
	CONSTRAINT "notification_deliveries_subject_id_nonblank" CHECK(length(trim("notification_deliveries"."subject_id")) > 0),
	CONSTRAINT "notification_deliveries_title_nonblank" CHECK(length(trim("notification_deliveries"."title")) > 0),
	CONSTRAINT "notification_deliveries_body_nonblank" CHECK(length(trim("notification_deliveries"."body")) > 0),
	CONSTRAINT "notification_deliveries_state_valid" CHECK("notification_deliveries"."state" in ('pending', 'running', 'delivered', 'failed', 'ambiguous')),
	CONSTRAINT "notification_deliveries_attempt_count_valid" CHECK("notification_deliveries"."attempt_count" >= 0),
	CONSTRAINT "notification_deliveries_next_attempt_valid" CHECK("notification_deliveries"."next_attempt_at" >= "notification_deliveries"."created_at"),
	CONSTRAINT "notification_deliveries_lease_valid" CHECK((
            ("notification_deliveries"."lease_token" is null and "notification_deliveries"."lease_expires_at" is null)
            or ("notification_deliveries"."lease_token" is not null and "notification_deliveries"."lease_expires_at" is not null and "notification_deliveries"."lease_expires_at" >= "notification_deliveries"."created_at")
        )),
	CONSTRAINT "notification_deliveries_terminal_time_valid" CHECK((
            ("notification_deliveries"."delivered_at" is null or "notification_deliveries"."delivered_at" >= "notification_deliveries"."created_at")
            and ("notification_deliveries"."failed_at" is null or "notification_deliveries"."failed_at" >= "notification_deliveries"."created_at")
            and ("notification_deliveries"."ambiguous_at" is null or "notification_deliveries"."ambiguous_at" >= "notification_deliveries"."created_at")
        ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_deliveries_project_destination_source_uidx` ON `notification_deliveries` (`project_id`,`destination_id`,`source_event_id`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_project_due_idx` ON `notification_deliveries` (`project_id`,`state`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_project_destination_idx` ON `notification_deliveries` (`project_id`,`destination_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `notification_delivery_projection_cursors` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`projection` text NOT NULL,
	`cursor` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_delivery_cursors_projection_nonblank" CHECK(length(trim("notification_delivery_projection_cursors"."projection")) > 0),
	CONSTRAINT "notification_delivery_cursors_cursor_nonblank" CHECK("notification_delivery_projection_cursors"."cursor" is null or length(trim("notification_delivery_projection_cursors"."cursor")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_delivery_cursors_project_projection_uidx` ON `notification_delivery_projection_cursors` (`project_id`,`projection`);--> statement-breakpoint
CREATE TABLE `notification_destinations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`recipient_actor_id` text NOT NULL,
	`transport_id` text NOT NULL,
	`label` text NOT NULL,
	`configuration_json` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`recipient_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_destinations_transport_nonblank" CHECK(length(trim("notification_destinations"."transport_id")) > 0),
	CONSTRAINT "notification_destinations_label_nonblank" CHECK(length(trim("notification_destinations"."label")) > 0),
	CONSTRAINT "notification_destinations_configuration_object" CHECK(json_valid("notification_destinations"."configuration_json") and json_type("notification_destinations"."configuration_json") = 'object'),
	CONSTRAINT "notification_destinations_state_valid" CHECK("notification_destinations"."state" in ('active', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_destinations_project_id_id_uidx` ON `notification_destinations` (`project_id`,`id`);--> statement-breakpoint
CREATE INDEX `notification_destinations_project_actor_state_idx` ON `notification_destinations` (`project_id`,`recipient_actor_id`,`state`);--> statement-breakpoint
CREATE TABLE `notification_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`destination_id` text NOT NULL,
	`kind` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`destination_id`) REFERENCES `notification_destinations`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_subscriptions_kind_valid" CHECK("notification_subscriptions"."kind" in ('publication_published', 'publication_failed', 'publication_ambiguous'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_subscriptions_project_destination_kind_uidx` ON `notification_subscriptions` (`project_id`,`destination_id`,`kind`);
