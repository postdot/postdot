CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`issuer` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_issuer_accountId_uidx` ON `account` (`issuer`,`account_id`);--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `apikey` (
	`id` text PRIMARY KEY NOT NULL,
	`config_id` text DEFAULT 'default' NOT NULL,
	`name` text,
	`start` text,
	`reference_id` text NOT NULL,
	`prefix` text,
	`key` text NOT NULL,
	`refill_interval` integer,
	`refill_amount` integer,
	`last_refill_at` integer,
	`enabled` integer DEFAULT true,
	`rate_limit_enabled` integer DEFAULT true,
	`rate_limit_time_window` integer DEFAULT 86400000,
	`rate_limit_max` integer DEFAULT 10,
	`request_count` integer DEFAULT 0,
	`remaining` integer,
	`last_request` integer,
	`expires_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`permissions` text,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `apikey_config_id_idx` ON `apikey` (`config_id`);--> statement-breakpoint
CREATE INDEX `apikey_reference_id_idx` ON `apikey` (`reference_id`);--> statement-breakpoint
CREATE INDEX `apikey_key_idx` ON `apikey` (`key`);--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`inviter_id` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invitation_organization_id_idx` ON `invitation` (`organization_id`);--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `member_organization_id_idx` ON `member` (`organization_id`);--> statement-breakpoint
CREATE INDEX `member_user_id_idx` ON `member` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `member_organization_user_uidx` ON `member` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE INDEX `organization_slug_idx` ON `organization` (`slug`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`impersonated_by` text,
	`active_organization_id` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`role` text,
	`banned` integer DEFAULT false,
	`ban_reason` text,
	`ban_expires` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `actors` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_id` text,
	`display_name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "actors_kind_valid" CHECK("actors"."kind" in ('human', 'agent', 'api_token', 'system')),
	CONSTRAINT "actors_display_name_nonblank" CHECK(length(trim("actors"."display_name")) > 0),
	CONSTRAINT "actors_subject_id_nonblank" CHECK("actors"."subject_id" is null or length(trim("actors"."subject_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `actors_project_id_id_uidx` ON `actors` (`project_id`,`id`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
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
	CONSTRAINT "audit_events_action_nonblank" CHECK(length(trim("audit_events"."action")) > 0),
	CONSTRAINT "audit_events_entity_type_nonblank" CHECK(length(trim("audit_events"."entity_type")) > 0),
	CONSTRAINT "audit_events_entity_id_nonblank" CHECK(length(trim("audit_events"."entity_id")) > 0),
	CONSTRAINT "audit_events_event_version_valid" CHECK("audit_events"."event_version" > 0),
	CONSTRAINT "audit_events_metadata_json_valid" CHECK("audit_events"."metadata_json" is null or (json_valid("audit_events"."metadata_json") and json_type("audit_events"."metadata_json") = 'object')),
	CONSTRAINT "audit_events_correlation_id_nonblank" CHECK("audit_events"."correlation_id" is null or length(trim("audit_events"."correlation_id")) > 0),
	CONSTRAINT "audit_events_causation_id_nonblank" CHECK("audit_events"."causation_id" is null or length(trim("audit_events"."causation_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_events_id_uidx` ON `audit_events` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `audit_events_project_id_id_uidx` ON `audit_events` (`project_id`,`id`);--> statement-breakpoint
CREATE INDEX `audit_events_project_id_sequence_idx` ON `audit_events` (`project_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `audit_events_project_id_created_at_idx` ON `audit_events` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_project_id_entity_idx` ON `audit_events` (`project_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `channel_profile_versions` (
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
	CONSTRAINT "channel_profile_versions_profile_id_nonblank" CHECK(length(trim("channel_profile_versions"."profile_id")) > 0),
	CONSTRAINT "channel_profile_versions_version_positive" CHECK("channel_profile_versions"."version" > 0),
	CONSTRAINT "channel_profile_versions_revision_positive" CHECK("channel_profile_versions"."revision" > 0),
	CONSTRAINT "channel_profile_versions_profile_json_object" CHECK(json_valid("channel_profile_versions"."profile_json") and json_type("channel_profile_versions"."profile_json") = 'object'),
	CONSTRAINT "channel_profile_versions_hashes_nonblank" CHECK(length(trim("channel_profile_versions"."profile_hash")) > 0 and length(trim("channel_profile_versions"."schema_hash")) > 0),
	CONSTRAINT "channel_profile_versions_origin_valid" CHECK("channel_profile_versions"."origin" in ('built_in', 'custom')),
	CONSTRAINT "channel_profile_versions_state_valid" CHECK("channel_profile_versions"."state" in ('draft', 'active', 'superseded', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_profile_versions_project_id_id_uidx` ON `channel_profile_versions` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `channel_profile_versions_project_channel_version_uidx` ON `channel_profile_versions` (`project_id`,`channel_id`,`version`);--> statement-breakpoint
CREATE INDEX `channel_profile_versions_project_channel_state_idx` ON `channel_profile_versions` (`project_id`,`channel_id`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `channel_profile_versions_project_channel_active_uidx` ON `channel_profile_versions` (`project_id`,`channel_id`) WHERE "channel_profile_versions"."state" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `channel_profile_versions_project_channel_draft_uidx` ON `channel_profile_versions` (`project_id`,`channel_id`) WHERE "channel_profile_versions"."state" = 'draft';--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`profile_version_id` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`archived_at` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "channels_profile_version_id_nonblank" CHECK(length(trim("channels"."profile_version_id")) > 0),
	CONSTRAINT "channels_name_nonblank" CHECK(length(trim("channels"."name")) > 0),
	CONSTRAINT "channels_state_valid" CHECK("channels"."state" in ('active', 'archived')),
	CONSTRAINT "channels_archived_timestamp_valid" CHECK(("channels"."state" = 'active' and "channels"."archived_at" is null)
                or ("channels"."state" = 'archived' and "channels"."archived_at" is not null)),
	CONSTRAINT "channels_revision_positive" CHECK("channels"."revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channels_project_id_id_uidx` ON `channels` (`project_id`,`id`);--> statement-breakpoint
CREATE TABLE `instance_access_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`target_email` text NOT NULL,
	`token_hash` text NOT NULL,
	`instance_role` text DEFAULT 'member' NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_by_user_id` text,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`accepted_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "instance_access_invitations_email_nonblank" CHECK(length(trim("instance_access_invitations"."target_email")) > 0),
	CONSTRAINT "instance_access_invitations_token_hash_nonblank" CHECK(length(trim("instance_access_invitations"."token_hash")) > 0),
	CONSTRAINT "instance_access_invitations_instance_role_valid" CHECK("instance_access_invitations"."instance_role" = 'member'),
	CONSTRAINT "instance_access_invitations_state_valid" CHECK(("instance_access_invitations"."state" = 'pending' and "instance_access_invitations"."accepted_at" is null and "instance_access_invitations"."accepted_by_user_id" is null and "instance_access_invitations"."revoked_at" is null)
                or ("instance_access_invitations"."state" = 'accepted' and "instance_access_invitations"."accepted_at" is not null and "instance_access_invitations"."accepted_by_user_id" is not null and "instance_access_invitations"."revoked_at" is null)
                or ("instance_access_invitations"."state" = 'revoked' and "instance_access_invitations"."accepted_at" is null and "instance_access_invitations"."accepted_by_user_id" is null and "instance_access_invitations"."revoked_at" is not null)
                or ("instance_access_invitations"."state" = 'expired' and "instance_access_invitations"."accepted_at" is null and "instance_access_invitations"."accepted_by_user_id" is null and "instance_access_invitations"."revoked_at" is null)),
	CONSTRAINT "instance_access_invitations_expiry_valid" CHECK("instance_access_invitations"."expires_at" > "instance_access_invitations"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instance_access_invitations_token_hash_uidx` ON `instance_access_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `instance_access_invitations_target_state_idx` ON `instance_access_invitations` (`target_email`,`state`);--> statement-breakpoint
CREATE INDEX `instance_access_invitations_expiry_idx` ON `instance_access_invitations` (`state`,`expires_at`);--> statement-breakpoint
CREATE TABLE `instance_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`state` text DEFAULT 'enabled' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "instance_memberships_role_valid" CHECK("instance_memberships"."role" in ('admin', 'member')),
	CONSTRAINT "instance_memberships_state_valid" CHECK("instance_memberships"."state" in ('enabled', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instance_memberships_user_uidx` ON `instance_memberships` (`user_id`);--> statement-breakpoint
CREATE TABLE `instance_state` (
	`id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`bootstrap_blocked` integer DEFAULT false NOT NULL,
	`claimed_by_user_id` text,
	`claimed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`claimed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "instance_state_singleton" CHECK("instance_state"."id" = 'default'),
	CONSTRAINT "instance_state_value_valid" CHECK("instance_state"."state" in ('claimable', 'claimed')),
	CONSTRAINT "instance_state_bootstrap_block_valid" CHECK("instance_state"."bootstrap_blocked" = 0 or "instance_state"."state" = 'claimable'),
	CONSTRAINT "instance_state_claim_consistency" CHECK(("instance_state"."state" = 'claimable' and "instance_state"."claimed_by_user_id" is null and "instance_state"."claimed_at" is null)
                or ("instance_state"."state" = 'claimed' and "instance_state"."claimed_by_user_id" is not null and "instance_state"."claimed_at" is not null))
);
--> statement-breakpoint
INSERT INTO `instance_state` (`id`, `state`, `bootstrap_blocked`, `claimed_by_user_id`, `claimed_at`)
VALUES ('default', 'claimable', 0, NULL, NULL);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`publication_id` text NOT NULL,
	`state` text NOT NULL,
	`run_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`claim_token` text,
	`claimed_by_actor_id` text,
	`claimed_at` integer,
	`lease_expires_at` integer,
	`effect_started_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`error_message` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`publication_id`) REFERENCES `publications`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`claimed_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "jobs_state_valid" CHECK("jobs"."state" in ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "jobs_attempts_nonnegative" CHECK("jobs"."attempts" >= 0),
	CONSTRAINT "jobs_running_has_started" CHECK("jobs"."state" <> 'running' or ("jobs"."claim_token" is not null and length(trim("jobs"."claim_token")) > 0 and "jobs"."claimed_by_actor_id" is not null and "jobs"."claimed_at" is not null and "jobs"."lease_expires_at" is not null and "jobs"."started_at" is not null and "jobs"."completed_at" is null and "jobs"."error_message" is null)),
	CONSTRAINT "jobs_pending_is_clean" CHECK("jobs"."state" <> 'pending' or ("jobs"."claim_token" is null and "jobs"."claimed_by_actor_id" is null and "jobs"."claimed_at" is null and "jobs"."lease_expires_at" is null and "jobs"."effect_started_at" is null and "jobs"."started_at" is null and "jobs"."completed_at" is null and "jobs"."error_message" is null)),
	CONSTRAINT "jobs_nonrunning_has_no_fence" CHECK("jobs"."state" = 'running' or ("jobs"."claim_token" is null and "jobs"."lease_expires_at" is null)),
	CONSTRAINT "jobs_lease_after_claim" CHECK("jobs"."lease_expires_at" is null or ("jobs"."claimed_at" is not null and "jobs"."lease_expires_at" > "jobs"."claimed_at")),
	CONSTRAINT "jobs_effect_after_claim" CHECK("jobs"."effect_started_at" is null or ("jobs"."claimed_at" is not null and "jobs"."effect_started_at" >= "jobs"."claimed_at")),
	CONSTRAINT "jobs_terminal_has_completed" CHECK("jobs"."state" not in ('succeeded', 'failed', 'cancelled') or "jobs"."completed_at" is not null),
	CONSTRAINT "jobs_failed_has_error" CHECK("jobs"."state" <> 'failed' or ("jobs"."error_message" is not null and length(trim("jobs"."error_message")) > 0)),
	CONSTRAINT "jobs_completed_attempt_has_started" CHECK("jobs"."state" not in ('succeeded', 'failed') or "jobs"."started_at" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_project_id_id_uidx` ON `jobs` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_project_publication_active_uidx` ON `jobs` (`project_id`,`publication_id`) WHERE "jobs"."state" in ('pending', 'running');--> statement-breakpoint
CREATE INDEX `jobs_project_id_publication_id_idx` ON `jobs` (`project_id`,`publication_id`);--> statement-breakpoint
CREATE INDEX `jobs_state_run_at_idx` ON `jobs` (`state`,`run_at`);--> statement-breakpoint
CREATE INDEX `jobs_state_lease_expires_at_idx` ON `jobs` (`state`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `jobs_project_id_claimed_by_actor_id_idx` ON `jobs` (`project_id`,`claimed_by_actor_id`);--> statement-breakpoint
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
CREATE INDEX `media_upload_intents_state_expires_idx` ON `media_upload_intents` (`state`,`expires_at`);--> statement-breakpoint
CREATE TABLE `notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`destination_id` text NOT NULL,
	`secret_id` text,
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
	FOREIGN KEY (`project_id`,`destination_id`,`secret_id`) REFERENCES `notification_destination_secrets`(`project_id`,`destination_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`source_event_id`) REFERENCES `audit_events`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_deliveries_transport_nonblank" CHECK(length(trim("notification_deliveries"."transport_id")) > 0),
	CONSTRAINT "notification_deliveries_configuration_object" CHECK(json_valid("notification_deliveries"."configuration_json") and json_type("notification_deliveries"."configuration_json") = 'object'),
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
CREATE TABLE `notification_destination_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`destination_id` text NOT NULL,
	`version` integer NOT NULL,
	`transport_id` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`encryption_version` integer NOT NULL,
	`encryption_key_id` text NOT NULL,
	`ciphertext` blob NOT NULL,
	`nonce` blob NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`destination_id`) REFERENCES `notification_destinations`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_destination_secrets_version_valid" CHECK("notification_destination_secrets"."version" > 0),
	CONSTRAINT "notification_destination_secrets_transport_nonblank" CHECK(length(trim("notification_destination_secrets"."transport_id")) > 0),
	CONSTRAINT "notification_destination_secrets_state_valid" CHECK("notification_destination_secrets"."state" in ('active', 'retired')),
	CONSTRAINT "notification_destination_secrets_encryption_version_valid" CHECK("notification_destination_secrets"."encryption_version" > 0),
	CONSTRAINT "notification_destination_secrets_encryption_key_nonblank" CHECK(length(trim("notification_destination_secrets"."encryption_key_id")) > 0),
	CONSTRAINT "notification_destination_secrets_ciphertext_valid" CHECK(length("notification_destination_secrets"."ciphertext") > 16),
	CONSTRAINT "notification_destination_secrets_nonce_valid" CHECK(length("notification_destination_secrets"."nonce") = 12)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_destination_secrets_project_id_id_uidx` ON `notification_destination_secrets` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_destination_secrets_project_destination_id_uidx` ON `notification_destination_secrets` (`project_id`,`destination_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_destination_secrets_project_destination_version_uidx` ON `notification_destination_secrets` (`project_id`,`destination_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_destination_secrets_project_destination_active_uidx` ON `notification_destination_secrets` (`project_id`,`destination_id`) WHERE "notification_destination_secrets"."state" = 'active';--> statement-breakpoint
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
CREATE TABLE `notification_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`recipient_actor_id` text NOT NULL,
	`kind` text NOT NULL,
	`in_app_enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`recipient_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_preferences_kind_valid" CHECK("notification_preferences"."kind" in ('publication_published', 'publication_failed', 'publication_ambiguous'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_preferences_recipient_kind_uidx` ON `notification_preferences` (`project_id`,`recipient_actor_id`,`kind`);--> statement-breakpoint
CREATE TABLE `notification_projection_cursors` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`projection` text NOT NULL,
	`cursor` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_projection_cursors_projection_nonblank" CHECK(length(trim("notification_projection_cursors"."projection")) > 0),
	CONSTRAINT "notification_projection_cursors_cursor_nonblank" CHECK("notification_projection_cursors"."cursor" is null or length(trim("notification_projection_cursors"."cursor")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_projection_cursors_project_projection_uidx` ON `notification_projection_cursors` (`project_id`,`projection`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `notification_subscriptions_project_destination_kind_uidx` ON `notification_subscriptions` (`project_id`,`destination_id`,`kind`);--> statement-breakpoint
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
CREATE TABLE `notifications` (
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
	CONSTRAINT "notifications_kind_valid" CHECK("notifications"."kind" in ('publication_published', 'publication_failed', 'publication_ambiguous')),
	CONSTRAINT "notifications_severity_valid" CHECK("notifications"."severity" in ('success', 'warning', 'error')),
	CONSTRAINT "notifications_project_actor_scope_valid" CHECK(("notifications"."project_id" is null and "notifications"."recipient_actor_id" is null)
                or ("notifications"."project_id" is not null and "notifications"."recipient_actor_id" is not null)),
	CONSTRAINT "notifications_recipient_user_nonblank" CHECK(length(trim("notifications"."recipient_user_id")) > 0),
	CONSTRAINT "notifications_subject_type_nonblank" CHECK(length(trim("notifications"."subject_type")) > 0),
	CONSTRAINT "notifications_subject_id_nonblank" CHECK(length(trim("notifications"."subject_id")) > 0),
	CONSTRAINT "notifications_title_nonblank" CHECK(length(trim("notifications"."title")) > 0),
	CONSTRAINT "notifications_body_nonblank" CHECK(length(trim("notifications"."body")) > 0),
	CONSTRAINT "notifications_read_at_valid" CHECK("notifications"."read_at" is null or "notifications"."read_at" >= "notifications"."created_at"),
	CONSTRAINT "notifications_archived_at_valid" CHECK("notifications"."archived_at" is null or "notifications"."archived_at" >= "notifications"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_user_project_source_event_uidx` ON `notifications` (`recipient_user_id`,`project_id`,`source_event_id`);--> statement-breakpoint
CREATE INDEX `notifications_user_inbox_idx` ON `notifications` (`recipient_user_id`,`project_id`,`archived_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_user_unread_idx` ON `notifications` (`recipient_user_id`,`project_id`,`read_at`,`archived_at`);--> statement-breakpoint
CREATE TABLE `oauth_authorization_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`connected_by_actor_id` text NOT NULL,
	`provider_application_id` text,
	`callback_uri` text NOT NULL,
	`scopes` text NOT NULL,
	`return_path` text NOT NULL,
	`context_json` text DEFAULT '{}' NOT NULL,
	`state_digest` blob NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`pkce_encryption_version` integer,
	`pkce_encryption_key_id` text,
	`pkce_verifier_ciphertext` blob,
	`pkce_verifier_nonce` blob,
	`provider_state_encryption_version` integer,
	`provider_state_encryption_key_id` text,
	`provider_state_ciphertext` blob,
	`provider_state_nonce` blob,
	`expires_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`channel_id`) REFERENCES `channels`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`connected_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`provider_id`,`provider_application_id`) REFERENCES `provider_application_configurations`(`provider_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "oauth_authorization_attempts_provider_nonblank" CHECK(length(trim("oauth_authorization_attempts"."provider_id")) > 0),
	CONSTRAINT "oauth_authorization_attempts_callback_nonblank" CHECK(length(trim("oauth_authorization_attempts"."callback_uri")) > 0),
	CONSTRAINT "oauth_authorization_attempts_return_path_local" CHECK(substr("oauth_authorization_attempts"."return_path", 1, 1) = '/'
                and substr("oauth_authorization_attempts"."return_path", 1, 2) != '//'
                and instr("oauth_authorization_attempts"."return_path", char(92)) = 0),
	CONSTRAINT "oauth_authorization_attempts_scopes_json_array" CHECK(json_valid("oauth_authorization_attempts"."scopes") and json_type("oauth_authorization_attempts"."scopes") = 'array'),
	CONSTRAINT "oauth_authorization_attempts_context_json_object" CHECK(json_valid("oauth_authorization_attempts"."context_json") and json_type("oauth_authorization_attempts"."context_json") = 'object'),
	CONSTRAINT "oauth_authorization_attempts_state_digest_length" CHECK(length("oauth_authorization_attempts"."state_digest") = 32),
	CONSTRAINT "oauth_authorization_attempts_status_valid" CHECK("oauth_authorization_attempts"."status" in ('pending', 'consumed', 'expired')),
	CONSTRAINT "oauth_authorization_attempts_time_valid" CHECK("oauth_authorization_attempts"."expires_at" > "oauth_authorization_attempts"."created_at"
                and ("oauth_authorization_attempts"."completed_at" is null or "oauth_authorization_attempts"."completed_at" >= "oauth_authorization_attempts"."created_at")),
	CONSTRAINT "oauth_authorization_attempts_secret_state_valid" CHECK((
                    "oauth_authorization_attempts"."status" = 'pending'
                    and "oauth_authorization_attempts"."completed_at" is null
                    and (
                        (
                            "oauth_authorization_attempts"."pkce_encryption_version" is null
                            and "oauth_authorization_attempts"."pkce_encryption_key_id" is null
                            and "oauth_authorization_attempts"."pkce_verifier_ciphertext" is null
                            and "oauth_authorization_attempts"."pkce_verifier_nonce" is null
                        ) or (
                            "oauth_authorization_attempts"."pkce_encryption_version" is not null
                            and "oauth_authorization_attempts"."pkce_encryption_version" > 0
                            and "oauth_authorization_attempts"."pkce_encryption_key_id" is not null
                            and length(trim("oauth_authorization_attempts"."pkce_encryption_key_id")) > 0
                            and "oauth_authorization_attempts"."pkce_verifier_ciphertext" is not null
                            and length("oauth_authorization_attempts"."pkce_verifier_ciphertext") > 16
                            and "oauth_authorization_attempts"."pkce_verifier_nonce" is not null
                            and length("oauth_authorization_attempts"."pkce_verifier_nonce") = 12
                        )
                    )
                    and (
                        (
                            "oauth_authorization_attempts"."provider_state_encryption_version" is null
                            and "oauth_authorization_attempts"."provider_state_encryption_key_id" is null
                            and "oauth_authorization_attempts"."provider_state_ciphertext" is null
                            and "oauth_authorization_attempts"."provider_state_nonce" is null
                        ) or (
                            "oauth_authorization_attempts"."provider_state_encryption_version" is not null
                            and "oauth_authorization_attempts"."provider_state_encryption_version" > 0
                            and "oauth_authorization_attempts"."provider_state_encryption_key_id" is not null
                            and length(trim("oauth_authorization_attempts"."provider_state_encryption_key_id")) > 0
                            and "oauth_authorization_attempts"."provider_state_ciphertext" is not null
                            and length("oauth_authorization_attempts"."provider_state_ciphertext") > 16
                            and "oauth_authorization_attempts"."provider_state_nonce" is not null
                            and length("oauth_authorization_attempts"."provider_state_nonce") = 12
                        )
                    )
                ) or (
                    "oauth_authorization_attempts"."status" in ('consumed', 'expired')
                    and "oauth_authorization_attempts"."completed_at" is not null
                    and "oauth_authorization_attempts"."pkce_encryption_version" is null
                    and "oauth_authorization_attempts"."pkce_encryption_key_id" is null
                    and "oauth_authorization_attempts"."pkce_verifier_ciphertext" is null
                    and "oauth_authorization_attempts"."pkce_verifier_nonce" is null
                    and "oauth_authorization_attempts"."provider_state_encryption_version" is null
                    and "oauth_authorization_attempts"."provider_state_encryption_key_id" is null
                    and "oauth_authorization_attempts"."provider_state_ciphertext" is null
                    and "oauth_authorization_attempts"."provider_state_nonce" is null
                ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_authorization_attempts_state_digest_uidx` ON `oauth_authorization_attempts` (`state_digest`);--> statement-breakpoint
CREATE INDEX `oauth_authorization_attempts_project_channel_idx` ON `oauth_authorization_attempts` (`project_id`,`channel_id`);--> statement-breakpoint
CREATE INDEX `oauth_authorization_attempts_status_expires_idx` ON `oauth_authorization_attempts` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text,
	`source_content` text NOT NULL,
	`source_revision` integer DEFAULT 1 NOT NULL,
	`created_by_actor_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`created_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "posts_title_nonblank" CHECK("posts"."title" is null or length(trim("posts"."title")) > 0),
	CONSTRAINT "posts_source_content_object" CHECK(json_valid("posts"."source_content") and json_type("posts"."source_content") = 'object'),
	CONSTRAINT "posts_source_revision_positive" CHECK("posts"."source_revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `posts_project_id_id_uidx` ON `posts` (`project_id`,`id`);--> statement-breakpoint
CREATE INDEX `posts_project_id_created_by_actor_id_idx` ON `posts` (`project_id`,`created_by_actor_id`);--> statement-breakpoint
CREATE TABLE `project_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "project_categories_name_nonblank" CHECK(length(trim("project_categories"."name")) > 0),
	CONSTRAINT "project_categories_normalized_name_nonblank" CHECK(length(trim("project_categories"."normalized_name")) > 0),
	CONSTRAINT "project_categories_name_length_valid" CHECK(length("project_categories"."name") <= 120 and length("project_categories"."normalized_name") <= 120),
	CONSTRAINT "project_categories_state_valid" CHECK("project_categories"."state" in ('active', 'archived')),
	CONSTRAINT "project_categories_archived_timestamp_valid" CHECK(("project_categories"."state" = 'active' and "project_categories"."archived_at" is null)
                or ("project_categories"."state" = 'archived' and "project_categories"."archived_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_categories_normalized_name_uidx` ON `project_categories` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `project_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_tags_name_nonblank" CHECK(length(trim("project_tags"."name")) > 0),
	CONSTRAINT "project_tags_normalized_name_nonblank" CHECK(length(trim("project_tags"."normalized_name")) > 0),
	CONSTRAINT "project_tags_name_length_valid" CHECK(length("project_tags"."name") <= 120 and length("project_tags"."normalized_name") <= 120),
	CONSTRAINT "project_tags_state_valid" CHECK("project_tags"."state" in ('active', 'archived')),
	CONSTRAINT "project_tags_archived_timestamp_valid" CHECK(("project_tags"."state" = 'active' and "project_tags"."archived_at" is null)
                or ("project_tags"."state" = 'archived' and "project_tags"."archived_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_tags_project_id_id_uidx` ON `project_tags` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_tags_project_id_normalized_name_uidx` ON `project_tags` (`project_id`,`normalized_name`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`time_zone` text DEFAULT 'UTC' NOT NULL,
	`organization_id` text,
	`primary_category_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`primary_category_id`) REFERENCES `project_categories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "projects_name_nonblank" CHECK(length(trim("projects"."name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_organization_id_uidx` ON `projects` (`organization_id`);--> statement-breakpoint
CREATE TABLE `provider_analytics_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`provider` text NOT NULL,
	`subject_type` text NOT NULL,
	`provider_subject_id` text NOT NULL,
	`provider_subject_label` text,
	`provider_content_revision_id` text,
	`herald_entity_type` text,
	`herald_entity_id` text,
	`metric_name` text NOT NULL,
	`value` real,
	`unit` text NOT NULL,
	`aggregation` text NOT NULL,
	`reporting_period_start` integer,
	`reporting_period_end` integer,
	`observed_at` integer,
	`fetched_at` integer NOT NULL,
	`availability` text NOT NULL,
	`freshness` text NOT NULL,
	`provenance` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "provider_analytics_observations_provider_nonblank" CHECK(length(trim("provider_analytics_observations"."provider")) > 0),
	CONSTRAINT "provider_analytics_observations_subject_id_nonblank" CHECK(length(trim("provider_analytics_observations"."provider_subject_id")) > 0),
	CONSTRAINT "provider_analytics_observations_subject_label_nonblank" CHECK("provider_analytics_observations"."provider_subject_label" is null or length(trim("provider_analytics_observations"."provider_subject_label")) > 0),
	CONSTRAINT "provider_analytics_observations_content_revision_nonblank" CHECK("provider_analytics_observations"."provider_content_revision_id" is null or length(trim("provider_analytics_observations"."provider_content_revision_id")) > 0),
	CONSTRAINT "provider_analytics_observations_entity_pair_valid" CHECK(("provider_analytics_observations"."herald_entity_type" is null and "provider_analytics_observations"."herald_entity_id" is null)
                or ("provider_analytics_observations"."herald_entity_type" is not null
                    and "provider_analytics_observations"."herald_entity_id" is not null
                    and length(trim("provider_analytics_observations"."herald_entity_id")) > 0)),
	CONSTRAINT "provider_analytics_observations_metric_nonblank" CHECK(length(trim("provider_analytics_observations"."metric_name")) > 0),
	CONSTRAINT "provider_analytics_observations_unit_nonblank" CHECK(length(trim("provider_analytics_observations"."unit")) > 0),
	CONSTRAINT "provider_analytics_observations_aggregation_nonblank" CHECK(length(trim("provider_analytics_observations"."aggregation")) > 0),
	CONSTRAINT "provider_analytics_observations_provenance_nonblank" CHECK(length(trim("provider_analytics_observations"."provenance")) > 0),
	CONSTRAINT "provider_analytics_observations_value_valid" CHECK("provider_analytics_observations"."value" is null or ("provider_analytics_observations"."value" >= 0 and "provider_analytics_observations"."value" = "provider_analytics_observations"."value")),
	CONSTRAINT "provider_analytics_observations_availability_value_valid" CHECK(("provider_analytics_observations"."availability" = 'measured' and "provider_analytics_observations"."value" is not null)
                or ("provider_analytics_observations"."availability" <> 'measured' and "provider_analytics_observations"."value" is null)),
	CONSTRAINT "provider_analytics_observations_period_valid" CHECK(("provider_analytics_observations"."reporting_period_start" is null and "provider_analytics_observations"."reporting_period_end" is null)
                or ("provider_analytics_observations"."reporting_period_start" is not null
                    and "provider_analytics_observations"."reporting_period_end" is not null
                    and "provider_analytics_observations"."reporting_period_start" >= 0
                    and "provider_analytics_observations"."reporting_period_end" > "provider_analytics_observations"."reporting_period_start")),
	CONSTRAINT "provider_analytics_observations_timestamps_valid" CHECK(("provider_analytics_observations"."observed_at" is null or "provider_analytics_observations"."observed_at" >= 0)
                and "provider_analytics_observations"."fetched_at" >= 0),
	CONSTRAINT "provider_analytics_observations_enum_valid" CHECK("provider_analytics_observations"."subject_type" in ('account', 'content')
                and ("provider_analytics_observations"."herald_entity_type" is null or "provider_analytics_observations"."herald_entity_type" in ('channel', 'publication'))
                and "provider_analytics_observations"."availability" in ('measured', 'not_reported', 'not_found', 'blocked', 'disabled', 'temporarily_unavailable', 'rate_limited', 'invalid_response', 'partial_response', 'not_configured', 'not_authorized', 'not_supported')
                and "provider_analytics_observations"."freshness" in ('fresh', 'stale', 'unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_analytics_observations_project_id_id_uidx` ON `provider_analytics_observations` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_analytics_observations_snapshot_uidx` ON `provider_analytics_observations` (`project_id`,`provider`,`subject_type`,`provider_subject_id`,`metric_name`,`fetched_at`);--> statement-breakpoint
CREATE INDEX `provider_analytics_observations_project_subject_idx` ON `provider_analytics_observations` (`project_id`,`provider`,`subject_type`,`provider_subject_id`,`fetched_at`);--> statement-breakpoint
CREATE INDEX `provider_analytics_observations_project_entity_idx` ON `provider_analytics_observations` (`project_id`,`herald_entity_type`,`herald_entity_id`,`fetched_at`);--> statement-breakpoint
CREATE TABLE `provider_application_configurations` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`name` text NOT NULL,
	`client_id` text,
	`client_metadata_url` text,
	`handle_resolver` text,
	`state` text DEFAULT 'active' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_by_user_id` text NOT NULL,
	`encryption_version` integer,
	`encryption_key_id` text,
	`client_secret_ciphertext` blob,
	`client_secret_nonce` blob,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "provider_application_configurations_provider_valid" CHECK("provider_application_configurations"."provider_id" in ('linkedin', 'bluesky', 'x')),
	CONSTRAINT "provider_application_configurations_name_nonblank" CHECK(length(trim("provider_application_configurations"."name")) > 0),
	CONSTRAINT "provider_application_configurations_state_valid" CHECK("provider_application_configurations"."state" in ('active', 'disabled')),
	CONSTRAINT "provider_application_configurations_shape_valid" CHECK((
                "provider_application_configurations"."provider_id" in ('linkedin', 'x')
                and "provider_application_configurations"."client_id" is not null
                and length(trim("provider_application_configurations"."client_id")) > 0
                and "provider_application_configurations"."client_metadata_url" is null
                and "provider_application_configurations"."handle_resolver" is null
                and "provider_application_configurations"."encryption_version" is not null
                and "provider_application_configurations"."encryption_key_id" is not null
                and "provider_application_configurations"."client_secret_ciphertext" is not null
                and "provider_application_configurations"."client_secret_nonce" is not null
            ) or (
                "provider_application_configurations"."provider_id" = 'bluesky'
                and "provider_application_configurations"."client_id" is null
                and ("provider_application_configurations"."client_metadata_url" is null or length(trim("provider_application_configurations"."client_metadata_url")) > 0)
                and "provider_application_configurations"."handle_resolver" is not null
                and length(trim("provider_application_configurations"."handle_resolver")) > 0
                and "provider_application_configurations"."encryption_version" is null
                and "provider_application_configurations"."encryption_key_id" is null
                and "provider_application_configurations"."client_secret_ciphertext" is null
                and "provider_application_configurations"."client_secret_nonce" is null
            )),
	CONSTRAINT "provider_application_configurations_encryption_version_valid" CHECK(("provider_application_configurations"."encryption_version" is null and "provider_application_configurations"."encryption_key_id" is null)
                or ("provider_application_configurations"."encryption_version" > 0 and "provider_application_configurations"."encryption_key_id" is not null
                    and length(trim("provider_application_configurations"."encryption_key_id")) > 0)),
	CONSTRAINT "provider_application_configurations_secret_envelope_valid" CHECK(("provider_application_configurations"."client_secret_ciphertext" is null and "provider_application_configurations"."client_secret_nonce" is null)
                or ("provider_application_configurations"."client_secret_ciphertext" is not null
                    and length("provider_application_configurations"."client_secret_ciphertext") > 16
                    and "provider_application_configurations"."client_secret_nonce" is not null
                    and length("provider_application_configurations"."client_secret_nonce") = 12))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_application_configurations_provider_id_id_uidx` ON `provider_application_configurations` (`provider_id`,`id`);--> statement-breakpoint
CREATE INDEX `provider_application_configurations_provider_state_idx` ON `provider_application_configurations` (`provider_id`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_application_configurations_provider_default_uidx` ON `provider_application_configurations` (`provider_id`) WHERE "provider_application_configurations"."is_default" = 1;--> statement-breakpoint
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
	CONSTRAINT "provider_media_deliveries_provider_nonblank" CHECK(length(trim("provider_media_deliveries"."provider_id")) > 0),
	CONSTRAINT "provider_media_deliveries_attempts_nonnegative" CHECK("provider_media_deliveries"."attempts" >= 0),
	CONSTRAINT "provider_media_deliveries_state_valid" CHECK("provider_media_deliveries"."state" in ('pending', 'uploading', 'uploaded', 'failed', 'ambiguous')),
	CONSTRAINT "provider_media_deliveries_timestamps_valid" CHECK(("provider_media_deliveries"."last_attempt_at" is null or "provider_media_deliveries"."last_attempt_at" >= "provider_media_deliveries"."created_at")
                and ("provider_media_deliveries"."completed_at" is null or "provider_media_deliveries"."completed_at" >= "provider_media_deliveries"."created_at")
                and ("provider_media_deliveries"."remote_media_expires_at" is null
                    or ("provider_media_deliveries"."completed_at" is not null and "provider_media_deliveries"."remote_media_expires_at" >= "provider_media_deliveries"."completed_at"))),
	CONSTRAINT "provider_media_deliveries_state_data_valid" CHECK(("provider_media_deliveries"."state" = 'pending'
                    and "provider_media_deliveries"."attempts" >= 0
                    and ("provider_media_deliveries"."last_attempt_at" is null or "provider_media_deliveries"."last_attempt_at" >= "provider_media_deliveries"."created_at")
                    and "provider_media_deliveries"."completed_at" is null
                    and "provider_media_deliveries"."remote_media_id" is null
                    and "provider_media_deliveries"."remote_media_url" is null
                    and "provider_media_deliveries"."remote_media_expires_at" is null
                    and "provider_media_deliveries"."error_code" is null
                    and "provider_media_deliveries"."error_message" is null)
                or ("provider_media_deliveries"."state" = 'uploading'
                    and "provider_media_deliveries"."attempts" > 0
                    and "provider_media_deliveries"."last_attempt_at" is not null
                    and "provider_media_deliveries"."completed_at" is null
                    and "provider_media_deliveries"."remote_media_expires_at" is null
                    and "provider_media_deliveries"."error_code" is null
                    and "provider_media_deliveries"."error_message" is null)
                or ("provider_media_deliveries"."state" = 'uploaded'
                    and "provider_media_deliveries"."attempts" > 0
                    and "provider_media_deliveries"."completed_at" is not null
                    and "provider_media_deliveries"."remote_media_id" is not null
                    and length(trim("provider_media_deliveries"."remote_media_id")) > 0
                    and ("provider_media_deliveries"."remote_media_expires_at" is null
                        or "provider_media_deliveries"."remote_media_expires_at" >= "provider_media_deliveries"."completed_at")
                    and "provider_media_deliveries"."error_code" is null
                    and "provider_media_deliveries"."error_message" is null)
                or ("provider_media_deliveries"."state" in ('failed', 'ambiguous')
                    and "provider_media_deliveries"."attempts" > 0
                    and "provider_media_deliveries"."completed_at" is not null
                    and "provider_media_deliveries"."remote_media_expires_at" is null
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
CREATE TABLE `publication_execution_revisions` (
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
	CONSTRAINT "publication_execution_revisions_delivery_mode_automatic" CHECK("publication_execution_revisions"."delivery_mode" = 'automatic'),
	CONSTRAINT "publication_execution_revisions_content_object" CHECK(json_valid("publication_execution_revisions"."content_json") and json_type("publication_execution_revisions"."content_json") = 'object'),
	CONSTRAINT "publication_execution_revisions_hashes_nonblank" CHECK(length(trim("publication_execution_revisions"."content_hash")) > 0 and length(trim("publication_execution_revisions"."profile_hash")) > 0 and length(trim("publication_execution_revisions"."schema_hash")) > 0),
	CONSTRAINT "publication_execution_revisions_media_reference_count_valid" CHECK("publication_execution_revisions"."media_reference_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_execution_revisions_project_job_uidx` ON `publication_execution_revisions` (`project_id`,`job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `publication_execution_revisions_project_id_id_uidx` ON `publication_execution_revisions` (`project_id`,`id`);--> statement-breakpoint
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
CREATE TABLE `publication_tags` (
	`project_id` text NOT NULL,
	`publication_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`project_id`, `publication_id`, `tag_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`publication_id`) REFERENCES `publications`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`tag_id`) REFERENCES `project_tags`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publication_tags_publication_id_nonblank" CHECK(length(trim("publication_tags"."publication_id")) > 0),
	CONSTRAINT "publication_tags_tag_id_nonblank" CHECK(length(trim("publication_tags"."tag_id")) > 0)
);
--> statement-breakpoint
CREATE INDEX `publication_tags_project_publication_idx` ON `publication_tags` (`project_id`,`publication_id`);--> statement-breakpoint
CREATE INDEX `publication_tags_project_tag_idx` ON `publication_tags` (`project_id`,`tag_id`);--> statement-breakpoint
CREATE TABLE `publication_target_revisions` (
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
	CONSTRAINT "publication_target_revisions_sequence_positive" CHECK("publication_target_revisions"."sequence" > 0),
	CONSTRAINT "publication_target_revisions_source_revision_positive" CHECK("publication_target_revisions"."source_revision" > 0),
	CONSTRAINT "publication_target_revisions_content_object" CHECK(json_valid("publication_target_revisions"."content_json") and json_type("publication_target_revisions"."content_json") = 'object'),
	CONSTRAINT "publication_target_revisions_validation_issues_array" CHECK(json_valid("publication_target_revisions"."validation_issues_json") and json_type("publication_target_revisions"."validation_issues_json") = 'array'),
	CONSTRAINT "publication_target_revisions_hashes_nonblank" CHECK(length(trim("publication_target_revisions"."content_hash")) > 0 and length(trim("publication_target_revisions"."profile_hash")) > 0 and length(trim("publication_target_revisions"."schema_hash")) > 0),
	CONSTRAINT "publication_target_revisions_delivery_mode_valid" CHECK("publication_target_revisions"."delivery_mode" in ('manual', 'automatic')),
	CONSTRAINT "publication_target_revisions_media_reference_count_valid" CHECK("publication_target_revisions"."media_reference_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_target_revisions_project_id_id_uidx` ON `publication_target_revisions` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `publication_target_revisions_project_publication_sequence_uidx` ON `publication_target_revisions` (`project_id`,`publication_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `publication_target_revisions_project_publication_idx` ON `publication_target_revisions` (`project_id`,`publication_id`);--> statement-breakpoint
CREATE TABLE `publication_working_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`publication_id` text NOT NULL,
	`profile_version_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`base_source_content` text DEFAULT '{}' NOT NULL,
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
	CONSTRAINT "publication_working_drafts_source_revision_positive" CHECK("publication_working_drafts"."source_revision" > 0),
	CONSTRAINT "publication_working_drafts_content_object" CHECK(json_valid("publication_working_drafts"."content_json") and json_type("publication_working_drafts"."content_json") = 'object'),
	CONSTRAINT "publication_working_drafts_validation_issues_array" CHECK(json_valid("publication_working_drafts"."validation_issues_json") and json_type("publication_working_drafts"."validation_issues_json") = 'array'),
	CONSTRAINT "publication_working_drafts_review_state_valid" CHECK("publication_working_drafts"."review_state" in ('compatible', 'review_required')),
	CONSTRAINT "publication_working_drafts_revision_positive" CHECK("publication_working_drafts"."revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_working_drafts_project_publication_uidx` ON `publication_working_drafts` (`project_id`,`publication_id`);--> statement-breakpoint
CREATE INDEX `publication_working_drafts_project_review_idx` ON `publication_working_drafts` (`project_id`,`review_state`);--> statement-breakpoint
CREATE TABLE `publications` (
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
	CONSTRAINT "publications_target_revision_id_nonblank" CHECK("publications"."target_revision_id" is null or length(trim("publications"."target_revision_id")) > 0),
	CONSTRAINT "publications_delivery_mode_valid" CHECK("publications"."delivery_mode" in ('manual', 'automatic')),
	CONSTRAINT "publications_review_state_valid" CHECK("publications"."review_state" in ('compatible', 'review_required')),
	CONSTRAINT "publications_profile_assessment_issues_array" CHECK(json_valid("publications"."profile_assessment_issues_json") and json_type("publications"."profile_assessment_issues_json") = 'array'),
	CONSTRAINT "publications_scheduled_target_valid" CHECK("publications"."state" <> 'scheduled' or "publications"."target_revision_id" is not null),
	CONSTRAINT "publications_state_valid" CHECK("publications"."state" in ('draft', 'scheduled', 'ready', 'publishing', 'published', 'failed', 'ambiguous', 'cancelled')),
	CONSTRAINT "publications_schedule_consistent" CHECK(("publications"."scheduled_at" is null and "publications"."scheduled_by_actor_id" is null) or ("publications"."scheduled_at" is not null and "publications"."scheduled_by_actor_id" is not null)),
	CONSTRAINT "publications_scheduled_state_has_time" CHECK("publications"."state" <> 'scheduled' or "publications"."scheduled_at" is not null),
	CONSTRAINT "publications_published_state_complete" CHECK("publications"."state" <> 'published' or ("publications"."published_at" is not null and "publications"."published_by_actor_id" is not null)),
	CONSTRAINT "publications_unpublished_state_has_no_result" CHECK("publications"."state" = 'published' or ("publications"."published_at" is null and "publications"."published_by_actor_id" is null)),
	CONSTRAINT "publications_failure_has_error" CHECK("publications"."state" not in ('failed', 'ambiguous') or ("publications"."error_message" is not null and length(trim("publications"."error_message")) > 0)),
	CONSTRAINT "publications_nonfailure_has_no_error" CHECK("publications"."state" in ('failed', 'ambiguous') or "publications"."error_message" is null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publications_project_id_id_uidx` ON `publications` (`project_id`,`id`);--> statement-breakpoint
CREATE INDEX `publications_project_id_post_id_idx` ON `publications` (`project_id`,`post_id`);--> statement-breakpoint
CREATE INDEX `publications_project_id_channel_id_idx` ON `publications` (`project_id`,`channel_id`);--> statement-breakpoint
CREATE INDEX `publications_state_scheduled_at_idx` ON `publications` (`state`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `publications_project_id_created_by_actor_id_idx` ON `publications` (`project_id`,`created_by_actor_id`);--> statement-breakpoint
CREATE INDEX `publications_project_id_scheduled_by_actor_id_idx` ON `publications` (`project_id`,`scheduled_by_actor_id`);--> statement-breakpoint
CREATE INDEX `publications_project_id_state_changed_by_actor_id_idx` ON `publications` (`project_id`,`state_changed_by_actor_id`);--> statement-breakpoint
CREATE INDEX `publications_project_id_published_by_actor_id_idx` ON `publications` (`project_id`,`published_by_actor_id`);--> statement-breakpoint
CREATE TABLE `publisher_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`publisher_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`endpoint_url` text,
	`authentication_json` text,
	`destination_type` text,
	`destination_id` text,
	`destination_name` text,
	`connected_by_actor_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`publisher_id`) REFERENCES `publishers`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`credential_id`) REFERENCES `publisher_credentials`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`connected_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publisher_connections_endpoint_url_nonblank" CHECK("publisher_connections"."endpoint_url" is null or length(trim("publisher_connections"."endpoint_url")) > 0),
	CONSTRAINT "publisher_connections_authentication_json_object" CHECK("publisher_connections"."authentication_json" is null or (json_valid("publisher_connections"."authentication_json") and json_type("publisher_connections"."authentication_json") = 'object')),
	CONSTRAINT "publisher_connections_destination_pair_valid" CHECK((
                ("publisher_connections"."destination_type" is null and "publisher_connections"."destination_id" is null and "publisher_connections"."destination_name" is null)
                or ("publisher_connections"."destination_type" is not null
                    and length(trim("publisher_connections"."destination_type")) > 0
                    and "publisher_connections"."destination_id" is not null
                    and length(trim("publisher_connections"."destination_id")) > 0
                    and ("publisher_connections"."destination_name" is null or length(trim("publisher_connections"."destination_name")) > 0))
            ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publisher_connections_project_id_publisher_id_uidx` ON `publisher_connections` (`project_id`,`publisher_id`);--> statement-breakpoint
CREATE INDEX `publisher_connections_credential_id_idx` ON `publisher_connections` (`credential_id`);--> statement-breakpoint
CREATE INDEX `publisher_connections_project_id_actor_id_idx` ON `publisher_connections` (`project_id`,`connected_by_actor_id`);--> statement-breakpoint
CREATE TABLE `publisher_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`external_account_id` text NOT NULL,
	`external_account_name` text,
	`scopes` text NOT NULL,
	`state` text NOT NULL,
	`expires_at` integer,
	`connected_by_actor_id` text NOT NULL,
	`provider_application_id` text,
	`encryption_version` integer,
	`encryption_key_id` text,
	`access_token_ciphertext` blob,
	`access_token_nonce` blob,
	`refresh_token_ciphertext` blob,
	`refresh_token_nonce` blob,
	`provider_session_ciphertext` blob,
	`provider_session_nonce` blob,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`connected_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`provider_id`,`provider_application_id`) REFERENCES `provider_application_configurations`(`provider_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publisher_credentials_provider_nonblank" CHECK(length(trim("publisher_credentials"."provider_id")) > 0),
	CONSTRAINT "publisher_credentials_external_account_nonblank" CHECK(length(trim("publisher_credentials"."external_account_id")) > 0),
	CONSTRAINT "publisher_credentials_external_name_nonblank" CHECK("publisher_credentials"."external_account_name" is null or length(trim("publisher_credentials"."external_account_name")) > 0),
	CONSTRAINT "publisher_credentials_scopes_json_array" CHECK(json_valid("publisher_credentials"."scopes") and json_type("publisher_credentials"."scopes") = 'array'),
	CONSTRAINT "publisher_credentials_state_valid" CHECK("publisher_credentials"."state" in ('active', 'reconnect_required', 'revoked')),
	CONSTRAINT "publisher_credentials_expiry_valid" CHECK("publisher_credentials"."expires_at" is null or "publisher_credentials"."expires_at" >= 0),
	CONSTRAINT "publisher_credentials_encryption_version_valid" CHECK("publisher_credentials"."encryption_version" is null or "publisher_credentials"."encryption_version" > 0),
	CONSTRAINT "publisher_credentials_encryption_key_nonblank" CHECK("publisher_credentials"."encryption_key_id" is null or length(trim("publisher_credentials"."encryption_key_id")) > 0),
	CONSTRAINT "publisher_credentials_secret_state_valid" CHECK((
                    "publisher_credentials"."state" in ('active', 'reconnect_required')
                    and "publisher_credentials"."encryption_version" is not null
                    and "publisher_credentials"."encryption_key_id" is not null
                    and "publisher_credentials"."access_token_ciphertext" is not null
                    and "publisher_credentials"."access_token_nonce" is not null
                    and length("publisher_credentials"."access_token_ciphertext") > 16
                    and length("publisher_credentials"."access_token_nonce") = 12
                ) or (
                    "publisher_credentials"."state" = 'revoked'
                    and "publisher_credentials"."encryption_version" is null
                    and "publisher_credentials"."encryption_key_id" is null
                    and "publisher_credentials"."access_token_ciphertext" is null
                    and "publisher_credentials"."access_token_nonce" is null
                    and "publisher_credentials"."refresh_token_ciphertext" is null
                    and "publisher_credentials"."refresh_token_nonce" is null
                    and "publisher_credentials"."provider_session_ciphertext" is null
                    and "publisher_credentials"."provider_session_nonce" is null
                )),
	CONSTRAINT "publisher_credentials_refresh_token_envelope_valid" CHECK(("publisher_credentials"."refresh_token_ciphertext" is null and "publisher_credentials"."refresh_token_nonce" is null)
                or ("publisher_credentials"."refresh_token_ciphertext" is not null
                    and "publisher_credentials"."refresh_token_nonce" is not null
                    and length("publisher_credentials"."refresh_token_ciphertext") > 16
                    and length("publisher_credentials"."refresh_token_nonce") = 12)),
	CONSTRAINT "publisher_credentials_provider_session_envelope_valid" CHECK(("publisher_credentials"."provider_session_ciphertext" is null and "publisher_credentials"."provider_session_nonce" is null)
                or ("publisher_credentials"."provider_session_ciphertext" is not null
                    and "publisher_credentials"."provider_session_nonce" is not null
                    and length("publisher_credentials"."provider_session_ciphertext") > 16
                    and length("publisher_credentials"."provider_session_nonce") = 12)),
	CONSTRAINT "publisher_credentials_revision_valid" CHECK("publisher_credentials"."revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publisher_credentials_project_id_id_uidx` ON `publisher_credentials` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `publisher_credentials_project_provider_external_uidx` ON `publisher_credentials` (`project_id`,`provider_id`,`external_account_id`);--> statement-breakpoint
CREATE INDEX `publisher_credentials_project_state_expires_idx` ON `publisher_credentials` (`project_id`,`state`,`expires_at`);--> statement-breakpoint
CREATE INDEX `publisher_credentials_project_actor_idx` ON `publisher_credentials` (`project_id`,`connected_by_actor_id`);--> statement-breakpoint
CREATE TABLE `publishers` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`channel_id`) REFERENCES `channels`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "publishers_kind_nonblank" CHECK(length(trim("publishers"."kind")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publishers_project_id_id_uidx` ON `publishers` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `publishers_project_id_channel_id_uidx` ON `publishers` (`project_id`,`channel_id`);
