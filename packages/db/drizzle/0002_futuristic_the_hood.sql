CREATE TABLE `media_backup_fences` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "media_backup_fences_singleton" CHECK("media_backup_fences"."id" = 1),
	CONSTRAINT "media_backup_fences_owner_nonblank" CHECK(length(trim("media_backup_fences"."owner_id")) > 0),
	CONSTRAINT "media_backup_fences_expiry_valid" CHECK("media_backup_fences"."expires_at" > "media_backup_fences"."created_at")
);
--> statement-breakpoint
CREATE TABLE `provider_media_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`execution_media_id` text NOT NULL,
	`publisher_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`remote_media_id` text,
	`remote_media_url` text,
	`last_attempt_at` integer,
	`completed_at` integer,
	`error_code` text,
	`error_message` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`execution_media_id`) REFERENCES `publication_execution_revision_media`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`publisher_id`) REFERENCES `publishers`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "provider_media_deliveries_provider_nonblank" CHECK(length(trim("provider_media_deliveries"."provider_id")) > 0),
	CONSTRAINT "provider_media_deliveries_attempts_nonnegative" CHECK("provider_media_deliveries"."attempts" >= 0),
	CONSTRAINT "provider_media_deliveries_state_valid" CHECK("provider_media_deliveries"."state" in ('pending', 'uploading', 'uploaded', 'failed', 'ambiguous')),
	CONSTRAINT "provider_media_deliveries_timestamps_valid" CHECK(("provider_media_deliveries"."last_attempt_at" is null or "provider_media_deliveries"."last_attempt_at" >= "provider_media_deliveries"."created_at")
                and ("provider_media_deliveries"."completed_at" is null or "provider_media_deliveries"."completed_at" >= "provider_media_deliveries"."created_at")),
	CONSTRAINT "provider_media_deliveries_state_data_valid" CHECK(("provider_media_deliveries"."state" = 'pending'
                    and "provider_media_deliveries"."attempts" >= 0
                    and ("provider_media_deliveries"."last_attempt_at" is null or "provider_media_deliveries"."last_attempt_at" >= "provider_media_deliveries"."created_at")
                    and "provider_media_deliveries"."completed_at" is null
                    and "provider_media_deliveries"."remote_media_id" is null
                    and "provider_media_deliveries"."remote_media_url" is null
                    and "provider_media_deliveries"."error_code" is null
                    and "provider_media_deliveries"."error_message" is null)
                or ("provider_media_deliveries"."state" = 'uploading'
                    and "provider_media_deliveries"."attempts" > 0
                    and "provider_media_deliveries"."last_attempt_at" is not null
                    and "provider_media_deliveries"."completed_at" is null
                    and "provider_media_deliveries"."remote_media_id" is null
                    and "provider_media_deliveries"."error_code" is null
                    and "provider_media_deliveries"."error_message" is null)
                or ("provider_media_deliveries"."state" = 'uploaded'
                    and "provider_media_deliveries"."attempts" > 0
                    and "provider_media_deliveries"."completed_at" is not null
                    and "provider_media_deliveries"."remote_media_id" is not null
                    and length(trim("provider_media_deliveries"."remote_media_id")) > 0
                    and "provider_media_deliveries"."error_code" is null
                    and "provider_media_deliveries"."error_message" is null)
                or ("provider_media_deliveries"."state" in ('failed', 'ambiguous')
                    and "provider_media_deliveries"."attempts" > 0
                    and "provider_media_deliveries"."completed_at" is not null
                    and "provider_media_deliveries"."error_code" is not null
                    and length(trim("provider_media_deliveries"."error_code")) > 0
                    and "provider_media_deliveries"."error_message" is not null
                    and length(trim("provider_media_deliveries"."error_message")) > 0)),
	CONSTRAINT "provider_media_deliveries_url_valid" CHECK("provider_media_deliveries"."remote_media_url" is null or length(trim("provider_media_deliveries"."remote_media_url")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_media_deliveries_project_id_id_uidx` ON `provider_media_deliveries` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_media_deliveries_execution_provider_uidx` ON `provider_media_deliveries` (`project_id`,`execution_media_id`,`publisher_id`,`provider_id`);--> statement-breakpoint
CREATE INDEX `provider_media_deliveries_project_state_idx` ON `provider_media_deliveries` (`project_id`,`state`);--> statement-breakpoint
CREATE TABLE `publication_execution_revision_media` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`execution_revision_id` text NOT NULL,
	`target_revision_media_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`representation_id` text NOT NULL,
	`position` integer NOT NULL,
	`content_path` text NOT NULL,
	`role` text,
	`accessibility_text` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`execution_revision_id`) REFERENCES `publication_execution_revisions`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`target_revision_media_id`) REFERENCES `publication_revision_media`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`asset_id`) REFERENCES `media_assets`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`asset_id`,`representation_id`) REFERENCES `media_representations`(`project_id`,`asset_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publication_execution_revision_media_position_nonnegative" CHECK("publication_execution_revision_media"."position" >= 0),
	CONSTRAINT "publication_execution_revision_media_content_path_valid" CHECK(length("publication_execution_revision_media"."content_path") > 1 and substr("publication_execution_revision_media"."content_path", 1, 1) = '/'),
	CONSTRAINT "publication_execution_revision_media_role_valid" CHECK("publication_execution_revision_media"."role" is null or length(trim("publication_execution_revision_media"."role")) > 0),
	CONSTRAINT "publication_execution_revision_media_accessibility_text_valid" CHECK("publication_execution_revision_media"."accessibility_text" is null or length(trim("publication_execution_revision_media"."accessibility_text")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_execution_revision_media_project_id_id_uidx` ON `publication_execution_revision_media` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `publication_execution_revision_media_revision_position_uidx` ON `publication_execution_revision_media` (`project_id`,`execution_revision_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `publication_execution_revision_media_revision_target_uidx` ON `publication_execution_revision_media` (`project_id`,`execution_revision_id`,`target_revision_media_id`);--> statement-breakpoint
CREATE INDEX `publication_execution_revision_media_project_asset_idx` ON `publication_execution_revision_media` (`project_id`,`asset_id`);--> statement-breakpoint
CREATE TABLE `publication_revision_media` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`target_revision_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`representation_id` text NOT NULL,
	`position` integer NOT NULL,
	`content_path` text NOT NULL,
	`role` text,
	`accessibility_text` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`target_revision_id`) REFERENCES `publication_target_revisions`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`asset_id`) REFERENCES `media_assets`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`asset_id`,`representation_id`) REFERENCES `media_representations`(`project_id`,`asset_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publication_revision_media_position_nonnegative" CHECK("publication_revision_media"."position" >= 0),
	CONSTRAINT "publication_revision_media_content_path_valid" CHECK(length("publication_revision_media"."content_path") > 1 and substr("publication_revision_media"."content_path", 1, 1) = '/'),
	CONSTRAINT "publication_revision_media_role_valid" CHECK("publication_revision_media"."role" is null or length(trim("publication_revision_media"."role")) > 0),
	CONSTRAINT "publication_revision_media_accessibility_text_valid" CHECK("publication_revision_media"."accessibility_text" is null or length(trim("publication_revision_media"."accessibility_text")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_revision_media_project_id_id_uidx` ON `publication_revision_media` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `publication_revision_media_project_revision_position_uidx` ON `publication_revision_media` (`project_id`,`target_revision_id`,`position`);--> statement-breakpoint
CREATE INDEX `publication_revision_media_project_asset_idx` ON `publication_revision_media` (`project_id`,`asset_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_publication_execution_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`job_id` text NOT NULL,
	`publication_id` text NOT NULL,
	`target_revision_id` text NOT NULL,
	`profile_version_id` text NOT NULL,
	`delivery_mode` text NOT NULL,
	`media_reference_count` integer DEFAULT 0 NOT NULL,
	`content_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`profile_hash` text NOT NULL,
	`schema_hash` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`job_id`) REFERENCES `jobs`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`publication_id`) REFERENCES `publications`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`target_revision_id`) REFERENCES `publication_target_revisions`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`profile_version_id`) REFERENCES `channel_profile_versions`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publication_execution_revisions_delivery_mode_automatic" CHECK("__new_publication_execution_revisions"."delivery_mode" = 'automatic'),
	CONSTRAINT "publication_execution_revisions_content_object" CHECK(json_valid("__new_publication_execution_revisions"."content_json") and json_type("__new_publication_execution_revisions"."content_json") = 'object'),
	CONSTRAINT "publication_execution_revisions_hashes_nonblank" CHECK(length(trim("__new_publication_execution_revisions"."content_hash")) > 0 and length(trim("__new_publication_execution_revisions"."profile_hash")) > 0 and length(trim("__new_publication_execution_revisions"."schema_hash")) > 0),
	CONSTRAINT "publication_execution_revisions_media_reference_count_valid" CHECK("__new_publication_execution_revisions"."media_reference_count" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_publication_execution_revisions`("id", "project_id", "job_id", "publication_id", "target_revision_id", "profile_version_id", "delivery_mode", "media_reference_count", "content_json", "content_hash", "profile_hash", "schema_hash", "created_at") SELECT "id", "project_id", "job_id", "publication_id", "target_revision_id", "profile_version_id", "delivery_mode", 0, "content_json", "content_hash", "profile_hash", "schema_hash", "created_at" FROM `publication_execution_revisions`;--> statement-breakpoint
DROP TABLE `publication_execution_revisions`;--> statement-breakpoint
ALTER TABLE `__new_publication_execution_revisions` RENAME TO `publication_execution_revisions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `publication_execution_revisions_project_job_uidx` ON `publication_execution_revisions` (`project_id`,`job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `publication_execution_revisions_project_id_id_uidx` ON `publication_execution_revisions` (`project_id`,`id`);--> statement-breakpoint
CREATE TABLE `__new_publication_target_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`publication_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`profile_version_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`delivery_mode` text NOT NULL,
	`media_reference_count` integer DEFAULT 0 NOT NULL,
	`content_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`profile_hash` text NOT NULL,
	`schema_hash` text NOT NULL,
	`validation_issues_json` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`publication_id`) REFERENCES `publications`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`profile_version_id`) REFERENCES `channel_profile_versions`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`created_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publication_target_revisions_sequence_positive" CHECK("__new_publication_target_revisions"."sequence" > 0),
	CONSTRAINT "publication_target_revisions_source_revision_positive" CHECK("__new_publication_target_revisions"."source_revision" > 0),
	CONSTRAINT "publication_target_revisions_content_object" CHECK(json_valid("__new_publication_target_revisions"."content_json") and json_type("__new_publication_target_revisions"."content_json") = 'object'),
	CONSTRAINT "publication_target_revisions_validation_issues_array" CHECK(json_valid("__new_publication_target_revisions"."validation_issues_json") and json_type("__new_publication_target_revisions"."validation_issues_json") = 'array'),
	CONSTRAINT "publication_target_revisions_hashes_nonblank" CHECK(length(trim("__new_publication_target_revisions"."content_hash")) > 0 and length(trim("__new_publication_target_revisions"."profile_hash")) > 0 and length(trim("__new_publication_target_revisions"."schema_hash")) > 0),
	CONSTRAINT "publication_target_revisions_delivery_mode_valid" CHECK("__new_publication_target_revisions"."delivery_mode" in ('manual', 'automatic')),
	CONSTRAINT "publication_target_revisions_media_reference_count_valid" CHECK("__new_publication_target_revisions"."media_reference_count" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_publication_target_revisions`("id", "project_id", "publication_id", "sequence", "profile_version_id", "source_revision", "delivery_mode", "media_reference_count", "content_json", "content_hash", "profile_hash", "schema_hash", "validation_issues_json", "created_by_actor_id", "created_at") SELECT "id", "project_id", "publication_id", "sequence", "profile_version_id", "source_revision", "delivery_mode", 0, "content_json", "content_hash", "profile_hash", "schema_hash", "validation_issues_json", "created_by_actor_id", "created_at" FROM `publication_target_revisions`;--> statement-breakpoint
DROP TABLE `publication_target_revisions`;--> statement-breakpoint
ALTER TABLE `__new_publication_target_revisions` RENAME TO `publication_target_revisions`;--> statement-breakpoint
CREATE UNIQUE INDEX `publication_target_revisions_project_id_id_uidx` ON `publication_target_revisions` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `publication_target_revisions_project_publication_sequence_uidx` ON `publication_target_revisions` (`project_id`,`publication_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `publication_target_revisions_project_publication_idx` ON `publication_target_revisions` (`project_id`,`publication_id`);
