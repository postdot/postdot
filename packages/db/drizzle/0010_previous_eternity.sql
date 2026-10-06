CREATE TABLE `publication_draft_adoptions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`publication_id` text NOT NULL,
	`profile_version_id` text NOT NULL,
	`adopted_profile_version_id` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`local_content_json` text,
	`target_revision_id` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`publication_id`) REFERENCES `publications`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`profile_version_id`) REFERENCES `channel_profile_versions`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`adopted_profile_version_id`) REFERENCES `channel_profile_versions`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`created_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`target_revision_id`) REFERENCES `publication_target_revisions`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publication_draft_adoptions_snapshot_object" CHECK(json_valid("publication_draft_adoptions"."snapshot_json") and json_type("publication_draft_adoptions"."snapshot_json") = 'object'),
	CONSTRAINT "publication_draft_adoptions_local_object" CHECK("publication_draft_adoptions"."local_content_json" is null or (json_valid("publication_draft_adoptions"."local_content_json") and json_type("publication_draft_adoptions"."local_content_json") = 'object'))
);
--> statement-breakpoint
CREATE INDEX `publication_draft_adoptions_publication_idx` ON `publication_draft_adoptions` (`project_id`,`publication_id`);