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
CREATE INDEX `publisher_credentials_project_actor_idx` ON `publisher_credentials` (`project_id`,`connected_by_actor_id`);