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
CREATE INDEX `oauth_authorization_attempts_status_expires_idx` ON `oauth_authorization_attempts` (`status`,`expires_at`);