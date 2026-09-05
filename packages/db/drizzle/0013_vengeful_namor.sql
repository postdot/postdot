PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_audit_events` (
	`sequence` integer PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`project_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`metadata_json` text,
	`event_version` integer DEFAULT 1 NOT NULL,
	`correlation_id` text,
	`causation_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "audit_events_action_nonblank" CHECK(length(trim("__new_audit_events"."action")) > 0),
	CONSTRAINT "audit_events_entity_type_nonblank" CHECK(length(trim("__new_audit_events"."entity_type")) > 0),
	CONSTRAINT "audit_events_entity_id_nonblank" CHECK(length(trim("__new_audit_events"."entity_id")) > 0),
	CONSTRAINT "audit_events_event_version_valid" CHECK("__new_audit_events"."event_version" > 0),
	CONSTRAINT "audit_events_metadata_json_valid" CHECK("__new_audit_events"."metadata_json" is null or (json_valid("__new_audit_events"."metadata_json") and json_type("__new_audit_events"."metadata_json") = 'object')),
	CONSTRAINT "audit_events_correlation_id_nonblank" CHECK("__new_audit_events"."correlation_id" is null or length(trim("__new_audit_events"."correlation_id")) > 0),
	CONSTRAINT "audit_events_causation_id_nonblank" CHECK("__new_audit_events"."causation_id" is null or length(trim("__new_audit_events"."causation_id")) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_audit_events`("sequence", "id", "project_id", "actor_id", "action", "entity_type", "entity_id", "metadata_json", "created_at") SELECT rowid, "id", "project_id", "actor_id", "action", "entity_type", "entity_id", "metadata_json", "created_at" FROM `audit_events`;--> statement-breakpoint
DROP TABLE `audit_events`;--> statement-breakpoint
ALTER TABLE `__new_audit_events` RENAME TO `audit_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `audit_events_id_uidx` ON `audit_events` (`id`);--> statement-breakpoint
CREATE INDEX `audit_events_project_id_sequence_idx` ON `audit_events` (`project_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `audit_events_project_id_created_at_idx` ON `audit_events` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_project_id_entity_idx` ON `audit_events` (`project_id`,`entity_type`,`entity_id`);
