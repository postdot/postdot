PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`destination_id` text NOT NULL,
	`source_event_id` text NOT NULL,
	`transport_id` text NOT NULL,
	`configuration_json` text NOT NULL,
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
	CONSTRAINT "notification_deliveries_transport_nonblank" CHECK(length(trim("__new_notification_deliveries"."transport_id")) > 0),
	CONSTRAINT "notification_deliveries_configuration_object" CHECK(json_valid("__new_notification_deliveries"."configuration_json") and json_type("__new_notification_deliveries"."configuration_json") = 'object'),
	CONSTRAINT "notification_deliveries_kind_valid" CHECK("__new_notification_deliveries"."kind" in ('publication_published', 'publication_failed', 'publication_ambiguous')),
	CONSTRAINT "notification_deliveries_severity_valid" CHECK("__new_notification_deliveries"."severity" in ('success', 'warning', 'error')),
	CONSTRAINT "notification_deliveries_subject_type_nonblank" CHECK(length(trim("__new_notification_deliveries"."subject_type")) > 0),
	CONSTRAINT "notification_deliveries_subject_id_nonblank" CHECK(length(trim("__new_notification_deliveries"."subject_id")) > 0),
	CONSTRAINT "notification_deliveries_title_nonblank" CHECK(length(trim("__new_notification_deliveries"."title")) > 0),
	CONSTRAINT "notification_deliveries_body_nonblank" CHECK(length(trim("__new_notification_deliveries"."body")) > 0),
	CONSTRAINT "notification_deliveries_state_valid" CHECK("__new_notification_deliveries"."state" in ('pending', 'running', 'delivered', 'failed', 'ambiguous')),
	CONSTRAINT "notification_deliveries_attempt_count_valid" CHECK("__new_notification_deliveries"."attempt_count" >= 0),
	CONSTRAINT "notification_deliveries_next_attempt_valid" CHECK("__new_notification_deliveries"."next_attempt_at" >= "__new_notification_deliveries"."created_at"),
	CONSTRAINT "notification_deliveries_lease_valid" CHECK((
            ("__new_notification_deliveries"."lease_token" is null and "__new_notification_deliveries"."lease_expires_at" is null)
            or ("__new_notification_deliveries"."lease_token" is not null and "__new_notification_deliveries"."lease_expires_at" is not null and "__new_notification_deliveries"."lease_expires_at" >= "__new_notification_deliveries"."created_at")
        )),
	CONSTRAINT "notification_deliveries_terminal_time_valid" CHECK((
            ("__new_notification_deliveries"."delivered_at" is null or "__new_notification_deliveries"."delivered_at" >= "__new_notification_deliveries"."created_at")
            and ("__new_notification_deliveries"."failed_at" is null or "__new_notification_deliveries"."failed_at" >= "__new_notification_deliveries"."created_at")
            and ("__new_notification_deliveries"."ambiguous_at" is null or "__new_notification_deliveries"."ambiguous_at" >= "__new_notification_deliveries"."created_at")
        ))
);
--> statement-breakpoint
INSERT INTO `__new_notification_deliveries`("id", "project_id", "destination_id", "source_event_id", "transport_id", "configuration_json", "kind", "severity", "subject_type", "subject_id", "title", "body", "state", "attempt_count", "next_attempt_at", "lease_token", "lease_expires_at", "effect_started_at", "delivered_at", "failed_at", "ambiguous_at", "external_id", "last_error", "created_at", "updated_at") SELECT "id", "project_id", "destination_id", "source_event_id", "transport_id", "configuration_json", "kind", "severity", "subject_type", "subject_id", "title", "body", "state", "attempt_count", "next_attempt_at", "lease_token", "lease_expires_at", "effect_started_at", "delivered_at", "failed_at", "ambiguous_at", "external_id", "last_error", "created_at", "updated_at" FROM `notification_deliveries`;--> statement-breakpoint
DROP TABLE `notification_deliveries`;--> statement-breakpoint
ALTER TABLE `__new_notification_deliveries` RENAME TO `notification_deliveries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `notification_deliveries_project_destination_source_uidx` ON `notification_deliveries` (`project_id`,`destination_id`,`source_event_id`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_project_due_idx` ON `notification_deliveries` (`project_id`,`state`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_project_destination_idx` ON `notification_deliveries` (`project_id`,`destination_id`,`created_at`);
