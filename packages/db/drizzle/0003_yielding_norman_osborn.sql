CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`metadata_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "audit_events_action_nonblank" CHECK(length(trim("audit_events"."action")) > 0),
	CONSTRAINT "audit_events_entity_type_nonblank" CHECK(length(trim("audit_events"."entity_type")) > 0),
	CONSTRAINT "audit_events_entity_id_nonblank" CHECK(length(trim("audit_events"."entity_id")) > 0)
);
--> statement-breakpoint
CREATE INDEX `audit_events_project_id_created_at_idx` ON `audit_events` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_project_id_entity_idx` ON `audit_events` (`project_id`,`entity_type`,`entity_id`);