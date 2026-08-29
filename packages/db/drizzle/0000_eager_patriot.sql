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
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
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
CREATE INDEX `audit_events_project_id_entity_idx` ON `audit_events` (`project_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "channels_name_nonblank" CHECK(length(trim("channels"."name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channels_project_id_id_uidx` ON `channels` (`project_id`,`id`);--> statement-breakpoint
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
CREATE INDEX `jobs_project_id_publication_id_idx` ON `jobs` (`project_id`,`publication_id`);--> statement-breakpoint
CREATE INDEX `jobs_state_run_at_idx` ON `jobs` (`state`,`run_at`);--> statement-breakpoint
CREATE INDEX `jobs_state_lease_expires_at_idx` ON `jobs` (`state`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `jobs_project_id_claimed_by_actor_id_idx` ON `jobs` (`project_id`,`claimed_by_actor_id`);--> statement-breakpoint
CREATE TABLE `oauth_authorization_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`connected_by_actor_id` text NOT NULL,
	`callback_uri` text NOT NULL,
	`scopes` text NOT NULL,
	`return_path` text NOT NULL,
	`state_digest` blob NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`pkce_encryption_version` integer,
	`pkce_encryption_key_id` text,
	`pkce_verifier_ciphertext` blob,
	`pkce_verifier_nonce` blob,
	`expires_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`channel_id`) REFERENCES `channels`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`connected_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "oauth_authorization_attempts_provider_nonblank" CHECK(length(trim("oauth_authorization_attempts"."provider_id")) > 0),
	CONSTRAINT "oauth_authorization_attempts_callback_nonblank" CHECK(length(trim("oauth_authorization_attempts"."callback_uri")) > 0),
	CONSTRAINT "oauth_authorization_attempts_return_path_local" CHECK(substr("oauth_authorization_attempts"."return_path", 1, 1) = '/'
                and substr("oauth_authorization_attempts"."return_path", 1, 2) != '//'
                and instr("oauth_authorization_attempts"."return_path", char(92)) = 0),
	CONSTRAINT "oauth_authorization_attempts_scopes_json_array" CHECK(json_valid("oauth_authorization_attempts"."scopes") and json_type("oauth_authorization_attempts"."scopes") = 'array'),
	CONSTRAINT "oauth_authorization_attempts_state_digest_length" CHECK(length("oauth_authorization_attempts"."state_digest") = 32),
	CONSTRAINT "oauth_authorization_attempts_status_valid" CHECK("oauth_authorization_attempts"."status" in ('pending', 'consumed', 'expired')),
	CONSTRAINT "oauth_authorization_attempts_time_valid" CHECK("oauth_authorization_attempts"."expires_at" > "oauth_authorization_attempts"."created_at"
                and ("oauth_authorization_attempts"."completed_at" is null or "oauth_authorization_attempts"."completed_at" >= "oauth_authorization_attempts"."created_at")),
	CONSTRAINT "oauth_authorization_attempts_secret_state_valid" CHECK((
                    "oauth_authorization_attempts"."status" = 'pending'
                    and "oauth_authorization_attempts"."completed_at" is null
                    and "oauth_authorization_attempts"."pkce_encryption_version" is not null
                    and "oauth_authorization_attempts"."pkce_encryption_version" > 0
                    and "oauth_authorization_attempts"."pkce_encryption_key_id" is not null
                    and length(trim("oauth_authorization_attempts"."pkce_encryption_key_id")) > 0
                    and "oauth_authorization_attempts"."pkce_verifier_ciphertext" is not null
                    and length("oauth_authorization_attempts"."pkce_verifier_ciphertext") > 16
                    and "oauth_authorization_attempts"."pkce_verifier_nonce" is not null
                    and length("oauth_authorization_attempts"."pkce_verifier_nonce") = 12
                ) or (
                    "oauth_authorization_attempts"."status" in ('consumed', 'expired')
                    and "oauth_authorization_attempts"."completed_at" is not null
                    and "oauth_authorization_attempts"."pkce_encryption_version" is null
                    and "oauth_authorization_attempts"."pkce_encryption_key_id" is null
                    and "oauth_authorization_attempts"."pkce_verifier_ciphertext" is null
                    and "oauth_authorization_attempts"."pkce_verifier_nonce" is null
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
	`content` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`created_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "posts_title_nonblank" CHECK("posts"."title" is null or length(trim("posts"."title")) > 0),
	CONSTRAINT "posts_content_nonblank" CHECK(length(trim("posts"."content")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `posts_project_id_id_uidx` ON `posts` (`project_id`,`id`);--> statement-breakpoint
CREATE INDEX `posts_project_id_created_by_actor_id_idx` ON `posts` (`project_id`,`created_by_actor_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "projects_name_nonblank" CHECK(length(trim("projects"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE `publications` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`post_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`content` text NOT NULL,
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
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`post_id`) REFERENCES `posts`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`channel_id`) REFERENCES `channels`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`created_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`scheduled_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`state_changed_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`published_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publications_content_nonblank" CHECK(length(trim("publications"."content")) > 0),
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
	`connected_by_actor_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`publisher_id`) REFERENCES `publishers`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`credential_id`) REFERENCES `publisher_credentials`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`connected_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict
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
	`encryption_version` integer,
	`encryption_key_id` text,
	`access_token_ciphertext` blob,
	`access_token_nonce` blob,
	`refresh_token_ciphertext` blob,
	`refresh_token_nonce` blob,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`connected_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
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
                )),
	CONSTRAINT "publisher_credentials_refresh_token_envelope_valid" CHECK(("publisher_credentials"."refresh_token_ciphertext" is null and "publisher_credentials"."refresh_token_nonce" is null)
                or ("publisher_credentials"."refresh_token_ciphertext" is not null
                    and "publisher_credentials"."refresh_token_nonce" is not null
                    and length("publisher_credentials"."refresh_token_ciphertext") > 16
                    and length("publisher_credentials"."refresh_token_nonce") = 12)),
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