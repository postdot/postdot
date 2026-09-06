PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_provider_media_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`execution_media_id` text NOT NULL,
	`publisher_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`remote_media_id` text,
	`remote_media_url` text,
	`remote_media_expires_at` integer,
	`last_attempt_at` integer,
	`completed_at` integer,
	`error_code` text,
	`error_message` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`execution_media_id`) REFERENCES `publication_execution_revision_media`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`publisher_id`) REFERENCES `publishers`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "provider_media_deliveries_provider_nonblank" CHECK(length(trim("__new_provider_media_deliveries"."provider_id")) > 0),
	CONSTRAINT "provider_media_deliveries_attempts_nonnegative" CHECK("__new_provider_media_deliveries"."attempts" >= 0),
	CONSTRAINT "provider_media_deliveries_state_valid" CHECK("__new_provider_media_deliveries"."state" in ('pending', 'uploading', 'uploaded', 'failed', 'ambiguous')),
	CONSTRAINT "provider_media_deliveries_timestamps_valid" CHECK(("__new_provider_media_deliveries"."last_attempt_at" is null or "__new_provider_media_deliveries"."last_attempt_at" >= "__new_provider_media_deliveries"."created_at")
                and ("__new_provider_media_deliveries"."completed_at" is null or "__new_provider_media_deliveries"."completed_at" >= "__new_provider_media_deliveries"."created_at")
                and ("__new_provider_media_deliveries"."remote_media_expires_at" is null
                    or ("__new_provider_media_deliveries"."completed_at" is not null and "__new_provider_media_deliveries"."remote_media_expires_at" >= "__new_provider_media_deliveries"."completed_at"))),
	CONSTRAINT "provider_media_deliveries_state_data_valid" CHECK(("__new_provider_media_deliveries"."state" = 'pending'
                    and "__new_provider_media_deliveries"."attempts" >= 0
                    and ("__new_provider_media_deliveries"."last_attempt_at" is null or "__new_provider_media_deliveries"."last_attempt_at" >= "__new_provider_media_deliveries"."created_at")
                    and "__new_provider_media_deliveries"."completed_at" is null
                    and "__new_provider_media_deliveries"."remote_media_id" is null
                    and "__new_provider_media_deliveries"."remote_media_url" is null
                    and "__new_provider_media_deliveries"."remote_media_expires_at" is null
                    and "__new_provider_media_deliveries"."error_code" is null
                    and "__new_provider_media_deliveries"."error_message" is null)
                or ("__new_provider_media_deliveries"."state" = 'uploading'
                    and "__new_provider_media_deliveries"."attempts" > 0
                    and "__new_provider_media_deliveries"."last_attempt_at" is not null
                    and "__new_provider_media_deliveries"."completed_at" is null
                    and "__new_provider_media_deliveries"."remote_media_expires_at" is null
                    and "__new_provider_media_deliveries"."error_code" is null
                    and "__new_provider_media_deliveries"."error_message" is null)
                or ("__new_provider_media_deliveries"."state" = 'uploaded'
                    and "__new_provider_media_deliveries"."attempts" > 0
                    and "__new_provider_media_deliveries"."completed_at" is not null
                    and "__new_provider_media_deliveries"."remote_media_id" is not null
                    and length(trim("__new_provider_media_deliveries"."remote_media_id")) > 0
                    and ("__new_provider_media_deliveries"."remote_media_expires_at" is null
                        or "__new_provider_media_deliveries"."remote_media_expires_at" >= "__new_provider_media_deliveries"."completed_at")
                    and "__new_provider_media_deliveries"."error_code" is null
                    and "__new_provider_media_deliveries"."error_message" is null)
                or ("__new_provider_media_deliveries"."state" in ('failed', 'ambiguous')
                    and "__new_provider_media_deliveries"."attempts" > 0
                    and "__new_provider_media_deliveries"."completed_at" is not null
                    and "__new_provider_media_deliveries"."remote_media_expires_at" is null
                    and "__new_provider_media_deliveries"."error_code" is not null
                    and length(trim("__new_provider_media_deliveries"."error_code")) > 0
                    and "__new_provider_media_deliveries"."error_message" is not null
                    and length(trim("__new_provider_media_deliveries"."error_message")) > 0)),
	CONSTRAINT "provider_media_deliveries_url_valid" CHECK("__new_provider_media_deliveries"."remote_media_url" is null or length(trim("__new_provider_media_deliveries"."remote_media_url")) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_provider_media_deliveries`("id", "project_id", "execution_media_id", "publisher_id", "provider_id", "state", "attempts", "remote_media_id", "remote_media_url", "remote_media_expires_at", "last_attempt_at", "completed_at", "error_code", "error_message", "created_at", "updated_at") SELECT "id", "project_id", "execution_media_id", "publisher_id", "provider_id", "state", "attempts", "remote_media_id", "remote_media_url", NULL, "last_attempt_at", "completed_at", "error_code", "error_message", "created_at", "updated_at" FROM `provider_media_deliveries`;--> statement-breakpoint
DROP TABLE `provider_media_deliveries`;--> statement-breakpoint
ALTER TABLE `__new_provider_media_deliveries` RENAME TO `provider_media_deliveries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `provider_media_deliveries_project_id_id_uidx` ON `provider_media_deliveries` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_media_deliveries_execution_provider_uidx` ON `provider_media_deliveries` (`project_id`,`execution_media_id`,`publisher_id`,`provider_id`);--> statement-breakpoint
CREATE INDEX `provider_media_deliveries_project_state_idx` ON `provider_media_deliveries` (`project_id`,`state`);
