PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_publications` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`post_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`target_revision_id` text,
	`delivery_mode` text NOT NULL,
	`review_state` text NOT NULL,
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
	`last_assessed_profile_version_id` text,
	`profile_assessment_issues_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`post_id`) REFERENCES `posts`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`channel_id`) REFERENCES `channels`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`created_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`scheduled_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`state_changed_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`published_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`last_assessed_profile_version_id`) REFERENCES `channel_profile_versions`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publications_target_revision_id_nonblank" CHECK("__new_publications"."target_revision_id" is null or length(trim("__new_publications"."target_revision_id")) > 0),
	CONSTRAINT "publications_delivery_mode_valid" CHECK("__new_publications"."delivery_mode" in ('manual', 'automatic')),
	CONSTRAINT "publications_review_state_valid" CHECK("__new_publications"."review_state" in ('compatible', 'review_required')),
	CONSTRAINT "publications_profile_assessment_issues_array" CHECK(json_valid("__new_publications"."profile_assessment_issues_json") and json_type("__new_publications"."profile_assessment_issues_json") = 'array'),
	CONSTRAINT "publications_scheduled_target_valid" CHECK("__new_publications"."state" <> 'scheduled' or "__new_publications"."target_revision_id" is not null),
	CONSTRAINT "publications_state_valid" CHECK("__new_publications"."state" in ('draft', 'scheduled', 'ready', 'publishing', 'published', 'failed', 'ambiguous', 'cancelled')),
	CONSTRAINT "publications_schedule_consistent" CHECK(("__new_publications"."scheduled_at" is null and "__new_publications"."scheduled_by_actor_id" is null) or ("__new_publications"."scheduled_at" is not null and "__new_publications"."scheduled_by_actor_id" is not null)),
	CONSTRAINT "publications_scheduled_state_has_time" CHECK("__new_publications"."state" <> 'scheduled' or "__new_publications"."scheduled_at" is not null),
	CONSTRAINT "publications_published_state_complete" CHECK("__new_publications"."state" <> 'published' or ("__new_publications"."published_at" is not null and "__new_publications"."published_by_actor_id" is not null)),
	CONSTRAINT "publications_unpublished_state_has_no_result" CHECK("__new_publications"."state" = 'published' or ("__new_publications"."published_at" is null and "__new_publications"."published_by_actor_id" is null)),
	CONSTRAINT "publications_failure_has_error" CHECK("__new_publications"."state" not in ('failed', 'ambiguous') or ("__new_publications"."error_message" is not null and length(trim("__new_publications"."error_message")) > 0)),
	CONSTRAINT "publications_nonfailure_has_no_error" CHECK("__new_publications"."state" in ('failed', 'ambiguous') or "__new_publications"."error_message" is null)
);
--> statement-breakpoint
INSERT INTO `__new_publications`("id", "project_id", "post_id", "channel_id", "target_revision_id", "delivery_mode", "review_state", "state", "scheduled_at", "published_at", "external_id", "external_url", "error_message", "created_by_actor_id", "scheduled_by_actor_id", "state_changed_by_actor_id", "published_by_actor_id", "last_assessed_profile_version_id", "profile_assessment_issues_json", "created_at", "updated_at") SELECT "id", "project_id", "post_id", "channel_id", "target_revision_id", "delivery_mode", "review_state", "state", "scheduled_at", "published_at", "external_id", "external_url", "error_message", "created_by_actor_id", "scheduled_by_actor_id", "state_changed_by_actor_id", "published_by_actor_id", NULL, '[]', "created_at", "updated_at" FROM `publications`;--> statement-breakpoint
DROP TABLE `publications`;--> statement-breakpoint
ALTER TABLE `__new_publications` RENAME TO `publications`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `publications_project_id_id_uidx` ON `publications` (`project_id`,`id`);--> statement-breakpoint
CREATE INDEX `publications_project_id_post_id_idx` ON `publications` (`project_id`,`post_id`);--> statement-breakpoint
CREATE INDEX `publications_project_id_channel_id_idx` ON `publications` (`project_id`,`channel_id`);--> statement-breakpoint
CREATE INDEX `publications_state_scheduled_at_idx` ON `publications` (`state`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `publications_project_id_created_by_actor_id_idx` ON `publications` (`project_id`,`created_by_actor_id`);--> statement-breakpoint
CREATE INDEX `publications_project_id_scheduled_by_actor_id_idx` ON `publications` (`project_id`,`scheduled_by_actor_id`);--> statement-breakpoint
CREATE INDEX `publications_project_id_state_changed_by_actor_id_idx` ON `publications` (`project_id`,`state_changed_by_actor_id`);--> statement-breakpoint
CREATE INDEX `publications_project_id_published_by_actor_id_idx` ON `publications` (`project_id`,`published_by_actor_id`);--> statement-breakpoint
CREATE TABLE `__new_channel_profile_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`version` integer NOT NULL,
	`origin` text NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`profile_json` text NOT NULL,
	`profile_hash` text NOT NULL,
	`schema_hash` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`channel_id`) REFERENCES `channels`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`created_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "channel_profile_versions_profile_id_nonblank" CHECK(length(trim("__new_channel_profile_versions"."profile_id")) > 0),
	CONSTRAINT "channel_profile_versions_version_positive" CHECK("__new_channel_profile_versions"."version" > 0),
	CONSTRAINT "channel_profile_versions_revision_positive" CHECK("__new_channel_profile_versions"."revision" > 0),
	CONSTRAINT "channel_profile_versions_profile_json_object" CHECK(json_valid("__new_channel_profile_versions"."profile_json") and json_type("__new_channel_profile_versions"."profile_json") = 'object'),
	CONSTRAINT "channel_profile_versions_hashes_nonblank" CHECK(length(trim("__new_channel_profile_versions"."profile_hash")) > 0 and length(trim("__new_channel_profile_versions"."schema_hash")) > 0),
	CONSTRAINT "channel_profile_versions_origin_valid" CHECK("__new_channel_profile_versions"."origin" in ('built_in', 'custom')),
	CONSTRAINT "channel_profile_versions_state_valid" CHECK("__new_channel_profile_versions"."state" in ('draft', 'active', 'superseded', 'disabled'))
);
--> statement-breakpoint
INSERT INTO `__new_channel_profile_versions`("id", "project_id", "channel_id", "profile_id", "version", "origin", "state", "revision", "profile_json", "profile_hash", "schema_hash", "created_by_actor_id", "created_at", "updated_at") SELECT "id", "project_id", "channel_id", "profile_id", "version", "origin", "state", 1, "profile_json", "profile_hash", "schema_hash", "created_by_actor_id", "created_at", "updated_at" FROM `channel_profile_versions`;--> statement-breakpoint
DROP TABLE `channel_profile_versions`;--> statement-breakpoint
ALTER TABLE `__new_channel_profile_versions` RENAME TO `channel_profile_versions`;--> statement-breakpoint
CREATE UNIQUE INDEX `channel_profile_versions_project_id_id_uidx` ON `channel_profile_versions` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `channel_profile_versions_project_channel_version_uidx` ON `channel_profile_versions` (`project_id`,`channel_id`,`version`);--> statement-breakpoint
CREATE INDEX `channel_profile_versions_project_channel_state_idx` ON `channel_profile_versions` (`project_id`,`channel_id`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `channel_profile_versions_project_channel_active_uidx` ON `channel_profile_versions` (`project_id`,`channel_id`) WHERE "channel_profile_versions"."state" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `channel_profile_versions_project_channel_draft_uidx` ON `channel_profile_versions` (`project_id`,`channel_id`) WHERE "channel_profile_versions"."state" = 'draft';--> statement-breakpoint
CREATE TABLE `__new_publication_working_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`publication_id` text NOT NULL,
	`profile_version_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`content_json` text NOT NULL,
	`review_state` text NOT NULL,
	`validation_issues_json` text NOT NULL,
	`last_assessed_profile_version_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_by_actor_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`publication_id`) REFERENCES `publications`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`profile_version_id`) REFERENCES `channel_profile_versions`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`last_assessed_profile_version_id`) REFERENCES `channel_profile_versions`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`updated_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publication_working_drafts_source_revision_positive" CHECK("__new_publication_working_drafts"."source_revision" > 0),
	CONSTRAINT "publication_working_drafts_content_object" CHECK(json_valid("__new_publication_working_drafts"."content_json") and json_type("__new_publication_working_drafts"."content_json") = 'object'),
	CONSTRAINT "publication_working_drafts_validation_issues_array" CHECK(json_valid("__new_publication_working_drafts"."validation_issues_json") and json_type("__new_publication_working_drafts"."validation_issues_json") = 'array'),
	CONSTRAINT "publication_working_drafts_review_state_valid" CHECK("__new_publication_working_drafts"."review_state" in ('compatible', 'review_required')),
	CONSTRAINT "publication_working_drafts_revision_positive" CHECK("__new_publication_working_drafts"."revision" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_publication_working_drafts`("id", "project_id", "publication_id", "profile_version_id", "source_revision", "content_json", "review_state", "validation_issues_json", "last_assessed_profile_version_id", "revision", "updated_by_actor_id", "created_at", "updated_at") SELECT "id", "project_id", "publication_id", "profile_version_id", "source_revision", "content_json", "review_state", "validation_issues_json", NULL, "revision", "updated_by_actor_id", "created_at", "updated_at" FROM `publication_working_drafts`;--> statement-breakpoint
DROP TABLE `publication_working_drafts`;--> statement-breakpoint
ALTER TABLE `__new_publication_working_drafts` RENAME TO `publication_working_drafts`;--> statement-breakpoint
CREATE UNIQUE INDEX `publication_working_drafts_project_publication_uidx` ON `publication_working_drafts` (`project_id`,`publication_id`);--> statement-breakpoint
CREATE INDEX `publication_working_drafts_project_review_idx` ON `publication_working_drafts` (`project_id`,`review_state`);
