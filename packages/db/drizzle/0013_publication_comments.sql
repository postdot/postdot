CREATE TABLE `publication_comment_snapshots` (
	`project_id` text NOT NULL,
	`publication_id` text NOT NULL,
	`root_uri` text NOT NULL,
	`snapshot_json` text,
	`last_attempt_at` integer NOT NULL,
	`last_error` text,
	PRIMARY KEY(`project_id`, `publication_id`),
	FOREIGN KEY (`project_id`,`publication_id`) REFERENCES `publications`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "publication_comment_snapshots_attempt_nonnegative" CHECK("publication_comment_snapshots"."last_attempt_at" >= 0)
);
