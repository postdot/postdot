CREATE TABLE `publication_comment_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`publication_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`root_uri` text NOT NULL,
	`parent_uri` text NOT NULL,
	`text` text NOT NULL,
	`connection_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`account_did` text NOT NULL,
	`record_key` text NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`claim_token` text,
	`lease_expires_at` integer,
	`effect_started_at` integer,
	`external_id` text,
	`external_url` text,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`,`publication_id`) REFERENCES `publications`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "publication_comment_replies_state_valid" CHECK("publication_comment_replies"."state" in ('pending', 'running', 'sent', 'failed', 'ambiguous')),
	CONSTRAINT "publication_comment_replies_text_nonblank" CHECK(length(trim("publication_comment_replies"."text")) > 0),
	CONSTRAINT "publication_comment_replies_attempts_valid" CHECK("publication_comment_replies"."attempts" >= 0),
	CONSTRAINT "publication_comment_replies_time_valid" CHECK("publication_comment_replies"."created_at" >= 0 and "publication_comment_replies"."updated_at" >= "publication_comment_replies"."created_at"),
	CONSTRAINT "publication_comment_replies_claim_valid" CHECK(("publication_comment_replies"."state" = 'running' and "publication_comment_replies"."claim_token" is not null and "publication_comment_replies"."lease_expires_at" is not null) or ("publication_comment_replies"."state" != 'running' and "publication_comment_replies"."claim_token" is null and "publication_comment_replies"."lease_expires_at" is null))
);
--> statement-breakpoint
CREATE INDEX `publication_comment_replies_due` ON `publication_comment_replies` (`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `publication_comment_replies_history` ON `publication_comment_replies` (`project_id`,`publication_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `publication_comment_replies_record` ON `publication_comment_replies` (`account_did`,`record_key`);