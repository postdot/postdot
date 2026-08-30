CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`original_filename` text NOT NULL,
	`default_accessibility_text` text,
	`state` text NOT NULL,
	`archived_at` integer,
	`deletion_requested_at` integer,
	`deleted_at` integer,
	`failure_code` text,
	`failure_message` text,
	`created_by_actor_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`created_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "media_assets_filename_valid" CHECK(length(trim("media_assets"."original_filename")) > 0 and length("media_assets"."original_filename") <= 255),
	CONSTRAINT "media_assets_accessibility_text_valid" CHECK("media_assets"."default_accessibility_text" is null or length(trim("media_assets"."default_accessibility_text")) > 0),
	CONSTRAINT "media_assets_state_valid" CHECK("media_assets"."state" in ('reserved', 'stored', 'inspecting', 'ready', 'failed', 'deletion_requested', 'deleted')),
	CONSTRAINT "media_assets_failure_valid" CHECK(("media_assets"."state" = 'failed'
                    and "media_assets"."failure_code" is not null
                    and length(trim("media_assets"."failure_code")) > 0
                    and "media_assets"."failure_message" is not null
                    and length(trim("media_assets"."failure_message")) > 0)
                or ("media_assets"."state" <> 'failed'
                    and "media_assets"."failure_code" is null
                    and "media_assets"."failure_message" is null)),
	CONSTRAINT "media_assets_deletion_timestamps_valid" CHECK((("media_assets"."state" in ('deletion_requested', 'deleted')
                    and "media_assets"."deletion_requested_at" is not null)
                or ("media_assets"."state" not in ('deletion_requested', 'deleted')
                    and "media_assets"."deletion_requested_at" is null))
                and (("media_assets"."state" = 'deleted'
                    and "media_assets"."deleted_at" is not null
                    or "media_assets"."state" <> 'deleted'
                    and "media_assets"."deleted_at" is null))),
	CONSTRAINT "media_assets_archived_timestamp_valid" CHECK("media_assets"."archived_at" is null or "media_assets"."archived_at" >= "media_assets"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_assets_project_id_id_uidx` ON `media_assets` (`project_id`,`id`);--> statement-breakpoint
CREATE INDEX `media_assets_project_state_idx` ON `media_assets` (`project_id`,`state`);--> statement-breakpoint
CREATE TABLE `media_representations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`kind` text NOT NULL,
	`source_representation_id` text,
	`state` text NOT NULL,
	`store_id` text NOT NULL,
	`object_key` text NOT NULL,
	`declared_content_type` text,
	`detected_content_type` text,
	`detected_format` text,
	`family` text,
	`byte_size` integer,
	`sha256` text,
	`width` integer,
	`height` integer,
	`duration_ms` integer,
	`page_count` integer,
	`is_animated` integer,
	`processor_id` text,
	`processor_version` text,
	`recipe_json` text,
	`failure_code` text,
	`failure_message` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`asset_id`) REFERENCES `media_assets`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`asset_id`,`source_representation_id`) REFERENCES `media_representations`(`project_id`,`asset_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "media_representations_kind_valid" CHECK("media_representations"."kind" in ('original', 'derived')),
	CONSTRAINT "media_representations_state_valid" CHECK("media_representations"."state" in ('reserved', 'stored', 'inspecting', 'ready', 'failed', 'deletion_requested', 'deleted')),
	CONSTRAINT "media_representations_store_locator_valid" CHECK(length(trim("media_representations"."store_id")) > 0
                and length(trim("media_representations"."object_key")) > 0
                and length("media_representations"."object_key") <= 1024),
	CONSTRAINT "media_representations_declared_type_valid" CHECK("media_representations"."declared_content_type" is null or length(trim("media_representations"."declared_content_type")) > 0),
	CONSTRAINT "media_representations_dimensions_valid" CHECK(("media_representations"."width" is null or "media_representations"."width" > 0)
                and ("media_representations"."height" is null or "media_representations"."height" > 0)
                and ("media_representations"."duration_ms" is null or "media_representations"."duration_ms" >= 0)
                and ("media_representations"."page_count" is null or "media_representations"."page_count" > 0)),
	CONSTRAINT "media_representations_hash_valid" CHECK("media_representations"."sha256" is null or length("media_representations"."sha256") = 64),
	CONSTRAINT "media_representations_family_valid" CHECK("media_representations"."family" is null or "media_representations"."family" in ('image', 'video', 'audio', 'document')),
	CONSTRAINT "media_representations_ready_facts_valid" CHECK("media_representations"."state" <> 'ready'
                or ("media_representations"."detected_content_type" is not null
                    and "media_representations"."detected_format" is not null
                    and "media_representations"."family" is not null
                    and "media_representations"."byte_size" is not null
                    and "media_representations"."sha256" is not null)),
	CONSTRAINT "media_representations_failure_valid" CHECK(("media_representations"."state" = 'failed'
                    and "media_representations"."failure_code" is not null
                    and length(trim("media_representations"."failure_code")) > 0
                    and "media_representations"."failure_message" is not null
                    and length(trim("media_representations"."failure_message")) > 0)
                or ("media_representations"."state" <> 'failed'
                    and "media_representations"."failure_code" is null
                    and "media_representations"."failure_message" is null)),
	CONSTRAINT "media_representations_derivation_valid" CHECK(("media_representations"."kind" = 'original'
                    and "media_representations"."source_representation_id" is null
                    and "media_representations"."processor_id" is null
                    and "media_representations"."processor_version" is null
                    and "media_representations"."recipe_json" is null)
                or ("media_representations"."kind" = 'derived'
                    and "media_representations"."source_representation_id" is not null
                    and "media_representations"."processor_id" is not null
                    and length(trim("media_representations"."processor_id")) > 0
                    and "media_representations"."processor_version" is not null
                    and length(trim("media_representations"."processor_version")) > 0
                    and "media_representations"."recipe_json" is not null
                    and json_valid("media_representations"."recipe_json")
                    and json_type("media_representations"."recipe_json") = 'object'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_representations_project_id_id_uidx` ON `media_representations` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_representations_project_asset_id_uidx` ON `media_representations` (`project_id`,`asset_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_representations_project_original_uidx` ON `media_representations` (`project_id`,`asset_id`) WHERE "media_representations"."kind" = 'original';--> statement-breakpoint
CREATE UNIQUE INDEX `media_representations_store_object_uidx` ON `media_representations` (`store_id`,`object_key`);--> statement-breakpoint
CREATE INDEX `media_representations_project_asset_idx` ON `media_representations` (`project_id`,`asset_id`);--> statement-breakpoint
CREATE INDEX `media_representations_project_state_idx` ON `media_representations` (`project_id`,`state`);--> statement-breakpoint
CREATE TABLE `media_upload_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`representation_id` text NOT NULL,
	`state` text NOT NULL,
	`expected_size` integer,
	`max_bytes` integer NOT NULL,
	`content_type_hint` text,
	`expires_at` integer NOT NULL,
	`upload_started_at` integer,
	`completed_at` integer,
	`failure_code` text,
	`failure_message` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`asset_id`) REFERENCES `media_assets`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`asset_id`,`representation_id`) REFERENCES `media_representations`(`project_id`,`asset_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "media_upload_intents_state_valid" CHECK("media_upload_intents"."state" in ('pending', 'uploading', 'uploaded', 'consumed', 'expired', 'failed')),
	CONSTRAINT "media_upload_intents_limits_valid" CHECK("media_upload_intents"."max_bytes" > 0
                and ("media_upload_intents"."expected_size" is null or ("media_upload_intents"."expected_size" >= 0 and "media_upload_intents"."expected_size" <= "media_upload_intents"."max_bytes"))),
	CONSTRAINT "media_upload_intents_content_type_valid" CHECK("media_upload_intents"."content_type_hint" is null or length(trim("media_upload_intents"."content_type_hint")) > 0),
	CONSTRAINT "media_upload_intents_expiry_valid" CHECK("media_upload_intents"."expires_at" > "media_upload_intents"."created_at"),
	CONSTRAINT "media_upload_intents_terminal_state_valid" CHECK(("media_upload_intents"."state" in ('pending', 'uploading', 'uploaded')
                    and "media_upload_intents"."completed_at" is null
                    and "media_upload_intents"."failure_code" is null
                    and "media_upload_intents"."failure_message" is null)
                or ("media_upload_intents"."state" in ('consumed', 'expired')
                    and "media_upload_intents"."completed_at" is not null
                    and "media_upload_intents"."failure_code" is null
                    and "media_upload_intents"."failure_message" is null)
                or ("media_upload_intents"."state" = 'failed'
                    and "media_upload_intents"."completed_at" is not null
                    and "media_upload_intents"."failure_code" is not null
                    and length(trim("media_upload_intents"."failure_code")) > 0
                    and "media_upload_intents"."failure_message" is not null
                    and length(trim("media_upload_intents"."failure_message")) > 0)),
	CONSTRAINT "media_upload_intents_upload_start_valid" CHECK("media_upload_intents"."upload_started_at" is null or "media_upload_intents"."upload_started_at" >= "media_upload_intents"."created_at"),
	CONSTRAINT "media_upload_intents_upload_start_state_valid" CHECK(("media_upload_intents"."state" = 'pending' and "media_upload_intents"."upload_started_at" is null)
                or ("media_upload_intents"."state" in ('uploading', 'uploaded', 'consumed')
                    and "media_upload_intents"."upload_started_at" is not null)
                or ("media_upload_intents"."state" in ('expired', 'failed')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_upload_intents_project_representation_uidx` ON `media_upload_intents` (`project_id`,`representation_id`);--> statement-breakpoint
CREATE INDEX `media_upload_intents_state_expires_idx` ON `media_upload_intents` (`state`,`expires_at`);
