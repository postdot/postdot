CREATE TABLE `installation_email_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`encryption_version` integer NOT NULL,
	`encryption_key_id` text NOT NULL,
	`nonce` blob NOT NULL,
	`ciphertext` blob NOT NULL,
	`updated_at` integer NOT NULL
);
