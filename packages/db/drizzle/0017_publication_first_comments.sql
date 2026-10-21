CREATE TABLE `publication_first_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`publication_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`text` text NOT NULL,
	`delay_seconds` integer NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`due_at` integer,
	`root_uri` text,
	`execution_revision_id` text,
	`connection_id` text,
	`credential_id` text,
	`account_id` text,
	`record_key` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`claim_token` text,
	`lease_expires_at` integer,
	`effect_started_at` integer,
	`external_id` text,
	`external_url` text,
	`last_error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`publication_id`) REFERENCES `publications`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publication_first_comments_state_valid" CHECK("publication_first_comments"."state" in ('waiting', 'pending', 'running', 'suspended', 'sent', 'failed', 'ambiguous', 'cancelled')),
	CONSTRAINT "publication_first_comments_text_nonblank" CHECK(length(trim("publication_first_comments"."text")) > 0),
	CONSTRAINT "publication_first_comments_delay_seconds_valid" CHECK("publication_first_comments"."delay_seconds" >= 0 and "publication_first_comments"."delay_seconds" <= 604800),
	CONSTRAINT "publication_first_comments_attempts_valid" CHECK("publication_first_comments"."attempts" >= 0),
	CONSTRAINT "publication_first_comments_revision_valid" CHECK("publication_first_comments"."revision" > 0),
	CONSTRAINT "publication_first_comments_record_key_nonblank" CHECK(length(trim("publication_first_comments"."record_key")) > 0),
	CONSTRAINT "publication_first_comments_time_valid" CHECK("publication_first_comments"."created_at" >= 0 and "publication_first_comments"."updated_at" >= "publication_first_comments"."created_at"),
	CONSTRAINT "publication_first_comments_claim_valid" CHECK(("publication_first_comments"."state" = 'running' and "publication_first_comments"."claim_token" is not null and "publication_first_comments"."lease_expires_at" is not null) or ("publication_first_comments"."state" != 'running' and "publication_first_comments"."claim_token" is null and "publication_first_comments"."lease_expires_at" is null)),
	CONSTRAINT "publication_first_comments_armed_identity" CHECK("publication_first_comments"."state" not in ('pending', 'running') or ("publication_first_comments"."due_at" is not null and "publication_first_comments"."root_uri" is not null and "publication_first_comments"."execution_revision_id" is not null and "publication_first_comments"."connection_id" is not null and "publication_first_comments"."credential_id" is not null and "publication_first_comments"."account_id" is not null)),
	CONSTRAINT "publication_first_comments_external_result_only_sent" CHECK(("publication_first_comments"."external_id" is null and "publication_first_comments"."external_url" is null) or "publication_first_comments"."state" = 'sent')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_first_comments_project_publication_uidx` ON `publication_first_comments` (`project_id`,`publication_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `publication_first_comments_project_record_key_uidx` ON `publication_first_comments` (`project_id`,`record_key`);--> statement-breakpoint
CREATE INDEX `publication_first_comments_state_due_at_idx` ON `publication_first_comments` (`state`,`due_at`);--> statement-breakpoint
CREATE INDEX `publication_first_comments_project_publication_idx` ON `publication_first_comments` (`project_id`,`publication_id`);