PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_oauth_authorization_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`connected_by_actor_id` text NOT NULL,
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
	`expires_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`channel_id`) REFERENCES `channels`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`connected_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
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
                ) or (
                    "__new_oauth_authorization_attempts"."status" in ('consumed', 'expired')
                    and "__new_oauth_authorization_attempts"."completed_at" is not null
                    and "__new_oauth_authorization_attempts"."pkce_encryption_version" is null
                    and "__new_oauth_authorization_attempts"."pkce_encryption_key_id" is null
                    and "__new_oauth_authorization_attempts"."pkce_verifier_ciphertext" is null
                    and "__new_oauth_authorization_attempts"."pkce_verifier_nonce" is null
                ))
);
--> statement-breakpoint
INSERT INTO `__new_oauth_authorization_attempts`("id", "project_id", "channel_id", "provider_id", "connected_by_actor_id", "callback_uri", "scopes", "return_path", "context_json", "state_digest", "status", "pkce_encryption_version", "pkce_encryption_key_id", "pkce_verifier_ciphertext", "pkce_verifier_nonce", "expires_at", "completed_at", "created_at", "updated_at") SELECT "id", "project_id", "channel_id", "provider_id", "connected_by_actor_id", "callback_uri", "scopes", "return_path", '{}' as "context_json", "state_digest", "status", "pkce_encryption_version", "pkce_encryption_key_id", "pkce_verifier_ciphertext", "pkce_verifier_nonce", "expires_at", "completed_at", "created_at", "updated_at" FROM `oauth_authorization_attempts`;--> statement-breakpoint
DROP TABLE `oauth_authorization_attempts`;--> statement-breakpoint
ALTER TABLE `__new_oauth_authorization_attempts` RENAME TO `oauth_authorization_attempts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_authorization_attempts_state_digest_uidx` ON `oauth_authorization_attempts` (`state_digest`);--> statement-breakpoint
CREATE INDEX `oauth_authorization_attempts_project_channel_idx` ON `oauth_authorization_attempts` (`project_id`,`channel_id`);--> statement-breakpoint
CREATE INDEX `oauth_authorization_attempts_status_expires_idx` ON `oauth_authorization_attempts` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `__new_publisher_connections` (
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
	CONSTRAINT "publisher_connections_endpoint_url_nonblank" CHECK("__new_publisher_connections"."endpoint_url" is null or length(trim("__new_publisher_connections"."endpoint_url")) > 0),
	CONSTRAINT "publisher_connections_authentication_json_object" CHECK("__new_publisher_connections"."authentication_json" is null or (json_valid("__new_publisher_connections"."authentication_json") and json_type("__new_publisher_connections"."authentication_json") = 'object')),
	CONSTRAINT "publisher_connections_destination_pair_valid" CHECK((
                ("__new_publisher_connections"."destination_type" is null and "__new_publisher_connections"."destination_id" is null and "__new_publisher_connections"."destination_name" is null)
                or ("__new_publisher_connections"."destination_type" is not null
                    and length(trim("__new_publisher_connections"."destination_type")) > 0
                    and "__new_publisher_connections"."destination_id" is not null
                    and length(trim("__new_publisher_connections"."destination_id")) > 0
                    and ("__new_publisher_connections"."destination_name" is null or length(trim("__new_publisher_connections"."destination_name")) > 0))
            ))
);
--> statement-breakpoint
INSERT INTO `__new_publisher_connections`("id", "project_id", "publisher_id", "credential_id", "endpoint_url", "authentication_json", "destination_type", "destination_id", "destination_name", "connected_by_actor_id", "created_at", "updated_at") SELECT publisher_connections."id", publisher_connections."project_id", publisher_connections."publisher_id", publisher_connections."credential_id", publisher_connections."endpoint_url", publisher_connections."authentication_json", CASE WHEN publishers."kind" = 'linkedin' THEN 'member' ELSE NULL END, CASE WHEN publishers."kind" = 'linkedin' THEN publisher_credentials."external_account_id" ELSE NULL END, CASE WHEN publishers."kind" = 'linkedin' THEN publisher_credentials."external_account_name" ELSE NULL END, publisher_connections."connected_by_actor_id", publisher_connections."created_at", publisher_connections."updated_at" FROM `publisher_connections` INNER JOIN `publishers` ON publishers."project_id" = publisher_connections."project_id" AND publishers."id" = publisher_connections."publisher_id" INNER JOIN `publisher_credentials` ON publisher_credentials."project_id" = publisher_connections."project_id" AND publisher_credentials."id" = publisher_connections."credential_id";--> statement-breakpoint
DROP TABLE `publisher_connections`;--> statement-breakpoint
ALTER TABLE `__new_publisher_connections` RENAME TO `publisher_connections`;--> statement-breakpoint
CREATE UNIQUE INDEX `publisher_connections_project_id_publisher_id_uidx` ON `publisher_connections` (`project_id`,`publisher_id`);--> statement-breakpoint
CREATE INDEX `publisher_connections_credential_id_idx` ON `publisher_connections` (`credential_id`);--> statement-breakpoint
CREATE INDEX `publisher_connections_project_id_actor_id_idx` ON `publisher_connections` (`project_id`,`connected_by_actor_id`);
