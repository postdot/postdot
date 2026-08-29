PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_jobs` (
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
	CONSTRAINT "jobs_state_valid" CHECK("__new_jobs"."state" in ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "jobs_attempts_nonnegative" CHECK("__new_jobs"."attempts" >= 0),
	CONSTRAINT "jobs_running_has_started" CHECK("__new_jobs"."state" <> 'running' or ("__new_jobs"."claim_token" is not null and length(trim("__new_jobs"."claim_token")) > 0 and "__new_jobs"."claimed_by_actor_id" is not null and "__new_jobs"."claimed_at" is not null and "__new_jobs"."lease_expires_at" is not null and "__new_jobs"."started_at" is not null and "__new_jobs"."completed_at" is null and "__new_jobs"."error_message" is null)),
	CONSTRAINT "jobs_pending_is_clean" CHECK("__new_jobs"."state" <> 'pending' or ("__new_jobs"."claim_token" is null and "__new_jobs"."claimed_by_actor_id" is null and "__new_jobs"."claimed_at" is null and "__new_jobs"."lease_expires_at" is null and "__new_jobs"."effect_started_at" is null and "__new_jobs"."started_at" is null and "__new_jobs"."completed_at" is null and "__new_jobs"."error_message" is null)),
	CONSTRAINT "jobs_nonrunning_has_no_fence" CHECK("__new_jobs"."state" = 'running' or ("__new_jobs"."claim_token" is null and "__new_jobs"."lease_expires_at" is null)),
	CONSTRAINT "jobs_lease_after_claim" CHECK("__new_jobs"."lease_expires_at" is null or ("__new_jobs"."claimed_at" is not null and "__new_jobs"."lease_expires_at" > "__new_jobs"."claimed_at")),
	CONSTRAINT "jobs_effect_after_claim" CHECK("__new_jobs"."effect_started_at" is null or ("__new_jobs"."claimed_at" is not null and "__new_jobs"."effect_started_at" >= "__new_jobs"."claimed_at")),
	CONSTRAINT "jobs_terminal_has_completed" CHECK("__new_jobs"."state" not in ('succeeded', 'failed', 'cancelled') or "__new_jobs"."completed_at" is not null),
	CONSTRAINT "jobs_failed_has_error" CHECK("__new_jobs"."state" <> 'failed' or ("__new_jobs"."error_message" is not null and length(trim("__new_jobs"."error_message")) > 0)),
	CONSTRAINT "jobs_completed_attempt_has_started" CHECK("__new_jobs"."state" not in ('succeeded', 'failed') or "__new_jobs"."started_at" is not null)
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "project_id", "publication_id", "state", "run_at", "attempts", "started_at", "completed_at", "error_message", "created_at", "updated_at") SELECT "id", "project_id", "publication_id", case when "state" = 'running' then 'failed' else "state" end, "run_at", "attempts", "started_at", case when "state" = 'running' then coalesce("completed_at", "updated_at") else "completed_at" end, case when "state" = 'running' then 'Migration recovered a legacy running job without claim metadata' else "error_message" end, "created_at", "updated_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `jobs_project_id_publication_id_idx` ON `jobs` (`project_id`,`publication_id`);--> statement-breakpoint
CREATE INDEX `jobs_state_run_at_idx` ON `jobs` (`state`,`run_at`);--> statement-breakpoint
CREATE INDEX `jobs_state_lease_expires_at_idx` ON `jobs` (`state`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `jobs_project_id_claimed_by_actor_id_idx` ON `jobs` (`project_id`,`claimed_by_actor_id`);
