-- Preserve the journal high-water mark even when its latest facts were deleted
-- with a retired project. Rebuilding AUTOINCREMENT must not reuse old cursors.
CREATE TABLE `__workspace_scope_sequence` (`seq` integer NOT NULL);
--> statement-breakpoint
INSERT INTO `__workspace_scope_sequence` SELECT coalesce(max(seq), 0) FROM sqlite_sequence WHERE name = 'audit_events';
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_actors` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`workspace_id` text,
	`origin_actor_id` text,
	`kind` text NOT NULL,
	`subject_id` text,
	`display_name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "actors_scope_valid" CHECK(("__new_actors"."project_id" is not null and "__new_actors"."workspace_id" is null and "__new_actors"."origin_actor_id" is null) or ("__new_actors"."project_id" is null and "__new_actors"."workspace_id" is not null)),
	CONSTRAINT "actors_origin_nonblank" CHECK("__new_actors"."origin_actor_id" is null or length(trim("__new_actors"."origin_actor_id")) > 0),
	CONSTRAINT "actors_kind_valid" CHECK("__new_actors"."kind" in ('human', 'agent', 'api_token', 'system')),
	CONSTRAINT "actors_display_name_nonblank" CHECK(length(trim("__new_actors"."display_name")) > 0),
	CONSTRAINT "actors_subject_id_nonblank" CHECK("__new_actors"."subject_id" is null or length(trim("__new_actors"."subject_id")) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_actors`("id", "project_id", "workspace_id", "origin_actor_id", "kind", "subject_id", "display_name", "created_at", "updated_at") SELECT "id", "project_id", NULL, NULL, "kind", "subject_id", "display_name", "created_at", "updated_at" FROM `actors`;--> statement-breakpoint
DROP TABLE `actors`;--> statement-breakpoint
ALTER TABLE `__new_actors` RENAME TO `actors`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `actors_project_id_id_uidx` ON `actors` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `actors_workspace_id_id_uidx` ON `actors` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `actors_workspace_origin_uidx` ON `actors` (`workspace_id`,`origin_actor_id`);--> statement-breakpoint
CREATE TABLE `__new_audit_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`project_id` text,
	`workspace_id` text,
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
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`actor_id`) REFERENCES `actors`(`workspace_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "audit_events_scope_valid" CHECK(("__new_audit_events"."project_id" is not null and "__new_audit_events"."workspace_id" is null) or ("__new_audit_events"."project_id" is null and "__new_audit_events"."workspace_id" is not null)),
	CONSTRAINT "audit_events_action_nonblank" CHECK(length(trim("__new_audit_events"."action")) > 0),
	CONSTRAINT "audit_events_entity_type_nonblank" CHECK(length(trim("__new_audit_events"."entity_type")) > 0),
	CONSTRAINT "audit_events_entity_id_nonblank" CHECK(length(trim("__new_audit_events"."entity_id")) > 0),
	CONSTRAINT "audit_events_event_version_valid" CHECK("__new_audit_events"."event_version" > 0),
	CONSTRAINT "audit_events_metadata_json_valid" CHECK("__new_audit_events"."metadata_json" is null or (json_valid("__new_audit_events"."metadata_json") and json_type("__new_audit_events"."metadata_json") = 'object')),
	CONSTRAINT "audit_events_correlation_id_nonblank" CHECK("__new_audit_events"."correlation_id" is null or length(trim("__new_audit_events"."correlation_id")) > 0),
	CONSTRAINT "audit_events_causation_id_nonblank" CHECK("__new_audit_events"."causation_id" is null or length(trim("__new_audit_events"."causation_id")) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_audit_events`("sequence", "id", "project_id", "workspace_id", "actor_id", "action", "entity_type", "entity_id", "metadata_json", "event_version", "correlation_id", "causation_id", "created_at") SELECT "sequence", "id", "project_id", NULL, "actor_id", "action", "entity_type", "entity_id", "metadata_json", "event_version", "correlation_id", "causation_id", "created_at" FROM `audit_events`;--> statement-breakpoint
DROP TABLE `audit_events`;--> statement-breakpoint
ALTER TABLE `__new_audit_events` RENAME TO `audit_events`;--> statement-breakpoint
CREATE UNIQUE INDEX `audit_events_id_uidx` ON `audit_events` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `audit_events_project_id_id_uidx` ON `audit_events` (`project_id`,`id`);--> statement-breakpoint
CREATE INDEX `audit_events_workspace_sequence_idx` ON `audit_events` (`workspace_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `audit_events_project_id_sequence_idx` ON `audit_events` (`project_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `audit_events_project_id_created_at_idx` ON `audit_events` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_project_id_entity_idx` ON `audit_events` (`project_id`,`entity_type`,`entity_id`);
--> statement-breakpoint
UPDATE sqlite_sequence SET seq = max(seq, (SELECT seq FROM __workspace_scope_sequence)) WHERE name = 'audit_events';
--> statement-breakpoint
INSERT INTO sqlite_sequence (name, seq) SELECT 'audit_events', seq FROM __workspace_scope_sequence WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'audit_events');
--> statement-breakpoint
DROP TABLE `__workspace_scope_sequence`;

--> statement-breakpoint
-- Delete scope actors after other owned rows have cascaded. RESTRICT references
-- to attribution must not depend on SQLite's order of sibling cascades.
CREATE TRIGGER `actors_cleanup_after_project_delete` AFTER DELETE ON `projects`
BEGIN DELETE FROM actors WHERE project_id = OLD.id; END;
--> statement-breakpoint
CREATE TRIGGER `actors_cleanup_after_workspace_delete` AFTER DELETE ON `workspaces`
BEGIN DELETE FROM actors WHERE workspace_id = OLD.id; END;
