PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_provider_application_configurations` (
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
	CONSTRAINT "provider_application_configurations_provider_valid" CHECK("__new_provider_application_configurations"."provider_id" in ('linkedin', 'bluesky', 'x', 'facebook')),
	CONSTRAINT "provider_application_configurations_name_nonblank" CHECK(length(trim("__new_provider_application_configurations"."name")) > 0),
	CONSTRAINT "provider_application_configurations_state_valid" CHECK("__new_provider_application_configurations"."state" in ('active', 'disabled')),
	CONSTRAINT "provider_application_configurations_shape_valid" CHECK((
                "__new_provider_application_configurations"."provider_id" in ('linkedin', 'x', 'facebook')
                and "__new_provider_application_configurations"."client_id" is not null
                and length(trim("__new_provider_application_configurations"."client_id")) > 0
                and "__new_provider_application_configurations"."client_metadata_url" is null
                and "__new_provider_application_configurations"."handle_resolver" is null
                and "__new_provider_application_configurations"."encryption_version" is not null
                and "__new_provider_application_configurations"."encryption_key_id" is not null
                and "__new_provider_application_configurations"."client_secret_ciphertext" is not null
                and "__new_provider_application_configurations"."client_secret_nonce" is not null
            ) or (
                "__new_provider_application_configurations"."provider_id" = 'bluesky'
                and "__new_provider_application_configurations"."client_id" is null
                and ("__new_provider_application_configurations"."client_metadata_url" is null or length(trim("__new_provider_application_configurations"."client_metadata_url")) > 0)
                and "__new_provider_application_configurations"."handle_resolver" is not null
                and length(trim("__new_provider_application_configurations"."handle_resolver")) > 0
                and "__new_provider_application_configurations"."encryption_version" is null
                and "__new_provider_application_configurations"."encryption_key_id" is null
                and "__new_provider_application_configurations"."client_secret_ciphertext" is null
                and "__new_provider_application_configurations"."client_secret_nonce" is null
            )),
	CONSTRAINT "provider_application_configurations_encryption_version_valid" CHECK(("__new_provider_application_configurations"."encryption_version" is null and "__new_provider_application_configurations"."encryption_key_id" is null)
                or ("__new_provider_application_configurations"."encryption_version" > 0 and "__new_provider_application_configurations"."encryption_key_id" is not null
                    and length(trim("__new_provider_application_configurations"."encryption_key_id")) > 0)),
	CONSTRAINT "provider_application_configurations_secret_envelope_valid" CHECK(("__new_provider_application_configurations"."client_secret_ciphertext" is null and "__new_provider_application_configurations"."client_secret_nonce" is null)
                or ("__new_provider_application_configurations"."client_secret_ciphertext" is not null
                    and length("__new_provider_application_configurations"."client_secret_ciphertext") > 16
                    and "__new_provider_application_configurations"."client_secret_nonce" is not null
                    and length("__new_provider_application_configurations"."client_secret_nonce") = 12))
);
--> statement-breakpoint
INSERT INTO `__new_provider_application_configurations`("id", "provider_id", "name", "client_id", "client_metadata_url", "handle_resolver", "state", "is_default", "created_by_user_id", "encryption_version", "encryption_key_id", "client_secret_ciphertext", "client_secret_nonce", "created_at", "updated_at") SELECT "id", "provider_id", "name", "client_id", "client_metadata_url", "handle_resolver", "state", "is_default", "created_by_user_id", "encryption_version", "encryption_key_id", "client_secret_ciphertext", "client_secret_nonce", "created_at", "updated_at" FROM `provider_application_configurations`;--> statement-breakpoint
DROP TABLE `provider_application_configurations`;--> statement-breakpoint
ALTER TABLE `__new_provider_application_configurations` RENAME TO `provider_application_configurations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `provider_application_configurations_provider_id_id_uidx` ON `provider_application_configurations` (`provider_id`,`id`);--> statement-breakpoint
CREATE INDEX `provider_application_configurations_provider_state_idx` ON `provider_application_configurations` (`provider_id`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_application_configurations_provider_default_uidx` ON `provider_application_configurations` (`provider_id`) WHERE "provider_application_configurations"."is_default" = 1;