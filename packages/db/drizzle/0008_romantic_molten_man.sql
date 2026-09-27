CREATE TABLE `publication_approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`publication_id` text NOT NULL,
	`target_revision_id` text NOT NULL,
	`draft_revision` integer NOT NULL,
	`proposed_scheduled_at` integer NOT NULL,
	`state` text NOT NULL,
	`requested_by_actor_id` text NOT NULL,
	`decided_by_actor_id` text,
	`decided_at` integer,
	`scheduled_at` integer,
	`rejection_reason` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`publication_id`) REFERENCES `publications`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`target_revision_id`) REFERENCES `publication_target_revisions`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`requested_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`decided_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publication_approval_requests_draft_revision_positive" CHECK("publication_approval_requests"."draft_revision" > 0),
	CONSTRAINT "publication_approval_requests_proposed_time_valid" CHECK("publication_approval_requests"."proposed_scheduled_at" > 0),
	CONSTRAINT "publication_approval_requests_state_valid" CHECK("publication_approval_requests"."state" in ('pending', 'approved', 'rejected', 'superseded')),
	CONSTRAINT "publication_approval_requests_decision_valid" CHECK(("publication_approval_requests"."state" = 'pending'
                    and "publication_approval_requests"."decided_by_actor_id" is null
                    and "publication_approval_requests"."decided_at" is null
                    and "publication_approval_requests"."scheduled_at" is null
                    and "publication_approval_requests"."rejection_reason" is null)
                or ("publication_approval_requests"."state" = 'approved'
                    and "publication_approval_requests"."decided_by_actor_id" is not null
                    and "publication_approval_requests"."decided_at" is not null
                    and "publication_approval_requests"."scheduled_at" is not null
                    and "publication_approval_requests"."rejection_reason" is null)
                or ("publication_approval_requests"."state" = 'rejected'
                    and "publication_approval_requests"."decided_by_actor_id" is not null
                    and "publication_approval_requests"."decided_at" is not null
                    and "publication_approval_requests"."scheduled_at" is null)
                or ("publication_approval_requests"."state" = 'superseded'
                    and "publication_approval_requests"."decided_by_actor_id" is not null
                    and "publication_approval_requests"."decided_at" is not null
                    and "publication_approval_requests"."scheduled_at" is null
                    and "publication_approval_requests"."rejection_reason" is null)),
	CONSTRAINT "publication_approval_requests_rejection_reason_valid" CHECK("publication_approval_requests"."rejection_reason" is null or length(trim("publication_approval_requests"."rejection_reason")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_approval_requests_project_id_id_uidx` ON `publication_approval_requests` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `publication_approval_requests_one_pending_per_publication_uidx` ON `publication_approval_requests` (`project_id`,`publication_id`) WHERE "publication_approval_requests"."state" = 'pending';--> statement-breakpoint
CREATE INDEX `publication_approval_requests_project_state_created_idx` ON `publication_approval_requests` (`project_id`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `publication_approval_requests_project_publication_created_idx` ON `publication_approval_requests` (`project_id`,`publication_id`,`created_at`);
