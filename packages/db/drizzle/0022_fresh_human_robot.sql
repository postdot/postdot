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
                and "provider_application_configurations"."client_metadata_url" is not null
                and length(trim("provider_application_configurations"."client_metadata_url")) > 0
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
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_oauth_authorization_attempts` (
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
	CONSTRAINT "oauth_authorization_attempts_provider_nonblank" CHECK(length(trim("__new_oauth_authorization_attempts"."provider_id")) > 0),
	CONSTRAINT "oauth_authorization_attempts_callback_nonblank" CHECK(length(trim("__new_oauth_authorization_attempts"."callback_uri")) > 0),
	CONSTRAINT "oauth_authorization_attempts_return_path_local" CHECK(substr("__new_oauth_authorization_attempts"."return_path", 1, 1) = '/'
                and substr("__new_oauth_authorization_attempts"."return_path", 1, 2) != '//'
                and instr("__new_oauth_authorization_attempts"."return_path", char(92)) = 0),
	CONSTRAINT "oauth_authorization_attempts_scopes_json_array" CHECK(json_valid("__new_oauth_authorization_attempts"."scopes") and json_type("__new_oauth_authorization_attempts"."scopes") = 'array'),
	CONSTRAINT "oauth_authorization_attempts_context_json_object" CHECK(json_valid("__new_oauth_authorization_attempts"."context_json") and json_type("__new_oauth_authorization_attempts"."context_json") = 'object'),
	CONSTRAINT "oauth_authorization_attempts_state_digest_length" CHECK(length("__new_oauth_authorization_attempts"."state_digest") = 32),
	CONSTRAINT "oauth_authorization_attempts_status_valid" CHECK("__new_oauth_authorization_attempts"."status" in ('pending', 'consumed', 'expired')),
	CONSTRAINT "oauth_authorization_attempts_time_valid" CHECK("__new_oauth_authorization_attempts"."expires_at" > "__new_oauth_authorization_attempts"."created_at"
                and ("__new_oauth_authorization_attempts"."completed_at" is null or "__new_oauth_authorization_attempts"."completed_at" >= "__new_oauth_authorization_attempts"."created_at")),
	CONSTRAINT "oauth_authorization_attempts_secret_state_valid" CHECK((
                    "__new_oauth_authorization_attempts"."status" = 'pending'
                    and "__new_oauth_authorization_attempts"."completed_at" is null
                    and (
                        (
                            "__new_oauth_authorization_attempts"."pkce_encryption_version" is null
                            and "__new_oauth_authorization_attempts"."pkce_encryption_key_id" is null
                            and "__new_oauth_authorization_attempts"."pkce_verifier_ciphertext" is null
                            and "__new_oauth_authorization_attempts"."pkce_verifier_nonce" is null
                        ) or (
                            "__new_oauth_authorization_attempts"."pkce_encryption_version" is not null
                            and "__new_oauth_authorization_attempts"."pkce_encryption_version" > 0
                            and "__new_oauth_authorization_attempts"."pkce_encryption_key_id" is not null
                            and length(trim("__new_oauth_authorization_attempts"."pkce_encryption_key_id")) > 0
                            and "__new_oauth_authorization_attempts"."pkce_verifier_ciphertext" is not null
                            and length("__new_oauth_authorization_attempts"."pkce_verifier_ciphertext") > 16
                            and "__new_oauth_authorization_attempts"."pkce_verifier_nonce" is not null
                            and length("__new_oauth_authorization_attempts"."pkce_verifier_nonce") = 12
                        )
                    )
                    and (
                        (
                            "__new_oauth_authorization_attempts"."provider_state_encryption_version" is null
                            and "__new_oauth_authorization_attempts"."provider_state_encryption_key_id" is null
                            and "__new_oauth_authorization_attempts"."provider_state_ciphertext" is null
                            and "__new_oauth_authorization_attempts"."provider_state_nonce" is null
                        ) or (
                            "__new_oauth_authorization_attempts"."provider_state_encryption_version" is not null
                            and "__new_oauth_authorization_attempts"."provider_state_encryption_version" > 0
                            and "__new_oauth_authorization_attempts"."provider_state_encryption_key_id" is not null
                            and length(trim("__new_oauth_authorization_attempts"."provider_state_encryption_key_id")) > 0
                            and "__new_oauth_authorization_attempts"."provider_state_ciphertext" is not null
                            and length("__new_oauth_authorization_attempts"."provider_state_ciphertext") > 16
                            and "__new_oauth_authorization_attempts"."provider_state_nonce" is not null
                            and length("__new_oauth_authorization_attempts"."provider_state_nonce") = 12
                        )
                    )
                ) or (
                    "__new_oauth_authorization_attempts"."status" in ('consumed', 'expired')
                    and "__new_oauth_authorization_attempts"."completed_at" is not null
                    and "__new_oauth_authorization_attempts"."pkce_encryption_version" is null
                    and "__new_oauth_authorization_attempts"."pkce_encryption_key_id" is null
                    and "__new_oauth_authorization_attempts"."pkce_verifier_ciphertext" is null
                    and "__new_oauth_authorization_attempts"."pkce_verifier_nonce" is null
                    and "__new_oauth_authorization_attempts"."provider_state_encryption_version" is null
                    and "__new_oauth_authorization_attempts"."provider_state_encryption_key_id" is null
                    and "__new_oauth_authorization_attempts"."provider_state_ciphertext" is null
                    and "__new_oauth_authorization_attempts"."provider_state_nonce" is null
                ))
);
--> statement-breakpoint
INSERT INTO `__new_oauth_authorization_attempts`("id", "project_id", "channel_id", "provider_id", "connected_by_actor_id", "provider_application_id", "callback_uri", "scopes", "return_path", "context_json", "state_digest", "status", "pkce_encryption_version", "pkce_encryption_key_id", "pkce_verifier_ciphertext", "pkce_verifier_nonce", "provider_state_encryption_version", "provider_state_encryption_key_id", "provider_state_ciphertext", "provider_state_nonce", "expires_at", "completed_at", "created_at", "updated_at") SELECT "id", "project_id", "channel_id", "provider_id", "connected_by_actor_id", "provider_application_id", "callback_uri", "scopes", "return_path", "context_json", "state_digest", "status", "pkce_encryption_version", "pkce_encryption_key_id", "pkce_verifier_ciphertext", "pkce_verifier_nonce", "provider_state_encryption_version", "provider_state_encryption_key_id", "provider_state_ciphertext", "provider_state_nonce", "expires_at", "completed_at", "created_at", "updated_at" FROM `oauth_authorization_attempts`;--> statement-breakpoint
DROP TABLE `oauth_authorization_attempts`;--> statement-breakpoint
ALTER TABLE `__new_oauth_authorization_attempts` RENAME TO `oauth_authorization_attempts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_authorization_attempts_state_digest_uidx` ON `oauth_authorization_attempts` (`state_digest`);--> statement-breakpoint
CREATE INDEX `oauth_authorization_attempts_project_channel_idx` ON `oauth_authorization_attempts` (`project_id`,`channel_id`);--> statement-breakpoint
CREATE INDEX `oauth_authorization_attempts_status_expires_idx` ON `oauth_authorization_attempts` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `__new_publisher_credentials` (
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
	CONSTRAINT "publisher_credentials_provider_nonblank" CHECK(length(trim("__new_publisher_credentials"."provider_id")) > 0),
	CONSTRAINT "publisher_credentials_external_account_nonblank" CHECK(length(trim("__new_publisher_credentials"."external_account_id")) > 0),
	CONSTRAINT "publisher_credentials_external_name_nonblank" CHECK("__new_publisher_credentials"."external_account_name" is null or length(trim("__new_publisher_credentials"."external_account_name")) > 0),
	CONSTRAINT "publisher_credentials_scopes_json_array" CHECK(json_valid("__new_publisher_credentials"."scopes") and json_type("__new_publisher_credentials"."scopes") = 'array'),
	CONSTRAINT "publisher_credentials_state_valid" CHECK("__new_publisher_credentials"."state" in ('active', 'reconnect_required', 'revoked')),
	CONSTRAINT "publisher_credentials_expiry_valid" CHECK("__new_publisher_credentials"."expires_at" is null or "__new_publisher_credentials"."expires_at" >= 0),
	CONSTRAINT "publisher_credentials_encryption_version_valid" CHECK("__new_publisher_credentials"."encryption_version" is null or "__new_publisher_credentials"."encryption_version" > 0),
	CONSTRAINT "publisher_credentials_encryption_key_nonblank" CHECK("__new_publisher_credentials"."encryption_key_id" is null or length(trim("__new_publisher_credentials"."encryption_key_id")) > 0),
	CONSTRAINT "publisher_credentials_secret_state_valid" CHECK((
                    "__new_publisher_credentials"."state" in ('active', 'reconnect_required')
                    and "__new_publisher_credentials"."encryption_version" is not null
                    and "__new_publisher_credentials"."encryption_key_id" is not null
                    and "__new_publisher_credentials"."access_token_ciphertext" is not null
                    and "__new_publisher_credentials"."access_token_nonce" is not null
                    and length("__new_publisher_credentials"."access_token_ciphertext") > 16
                    and length("__new_publisher_credentials"."access_token_nonce") = 12
                ) or (
                    "__new_publisher_credentials"."state" = 'revoked'
                    and "__new_publisher_credentials"."encryption_version" is null
                    and "__new_publisher_credentials"."encryption_key_id" is null
                    and "__new_publisher_credentials"."access_token_ciphertext" is null
                    and "__new_publisher_credentials"."access_token_nonce" is null
                    and "__new_publisher_credentials"."refresh_token_ciphertext" is null
                    and "__new_publisher_credentials"."refresh_token_nonce" is null
                    and "__new_publisher_credentials"."provider_session_ciphertext" is null
                    and "__new_publisher_credentials"."provider_session_nonce" is null
                )),
	CONSTRAINT "publisher_credentials_refresh_token_envelope_valid" CHECK(("__new_publisher_credentials"."refresh_token_ciphertext" is null and "__new_publisher_credentials"."refresh_token_nonce" is null)
                or ("__new_publisher_credentials"."refresh_token_ciphertext" is not null
                    and "__new_publisher_credentials"."refresh_token_nonce" is not null
                    and length("__new_publisher_credentials"."refresh_token_ciphertext") > 16
                    and length("__new_publisher_credentials"."refresh_token_nonce") = 12)),
	CONSTRAINT "publisher_credentials_provider_session_envelope_valid" CHECK(("__new_publisher_credentials"."provider_session_ciphertext" is null and "__new_publisher_credentials"."provider_session_nonce" is null)
                or ("__new_publisher_credentials"."provider_session_ciphertext" is not null
                    and "__new_publisher_credentials"."provider_session_nonce" is not null
                    and length("__new_publisher_credentials"."provider_session_ciphertext") > 16
                    and length("__new_publisher_credentials"."provider_session_nonce") = 12)),
	CONSTRAINT "publisher_credentials_revision_valid" CHECK("__new_publisher_credentials"."revision" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_publisher_credentials`("id", "project_id", "provider_id", "external_account_id", "external_account_name", "scopes", "state", "expires_at", "connected_by_actor_id", "provider_application_id", "encryption_version", "encryption_key_id", "access_token_ciphertext", "access_token_nonce", "refresh_token_ciphertext", "refresh_token_nonce", "provider_session_ciphertext", "provider_session_nonce", "revision", "created_at", "updated_at") SELECT "id", "project_id", "provider_id", "external_account_id", "external_account_name", "scopes", "state", "expires_at", "connected_by_actor_id", "provider_application_id", "encryption_version", "encryption_key_id", "access_token_ciphertext", "access_token_nonce", "refresh_token_ciphertext", "refresh_token_nonce", "provider_session_ciphertext", "provider_session_nonce", "revision", "created_at", "updated_at" FROM `publisher_credentials`;--> statement-breakpoint
DROP TABLE `publisher_credentials`;--> statement-breakpoint
ALTER TABLE `__new_publisher_credentials` RENAME TO `publisher_credentials`;--> statement-breakpoint
CREATE UNIQUE INDEX `publisher_credentials_project_id_id_uidx` ON `publisher_credentials` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `publisher_credentials_project_provider_external_uidx` ON `publisher_credentials` (`project_id`,`provider_id`,`external_account_id`);--> statement-breakpoint
CREATE INDEX `publisher_credentials_project_state_expires_idx` ON `publisher_credentials` (`project_id`,`state`,`expires_at`);--> statement-breakpoint
CREATE INDEX `publisher_credentials_project_actor_idx` ON `publisher_credentials` (`project_id`,`connected_by_actor_id`);