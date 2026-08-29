CREATE TABLE `publisher_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`publisher_id` text NOT NULL,
	`account_id` text NOT NULL,
	`connected_by_actor_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`publisher_id`) REFERENCES `publishers`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`connected_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publisher_connections_project_id_publisher_id_uidx` ON `publisher_connections` (`project_id`,`publisher_id`);--> statement-breakpoint
CREATE INDEX `publisher_connections_account_id_idx` ON `publisher_connections` (`account_id`);--> statement-breakpoint
CREATE INDEX `publisher_connections_project_id_actor_id_idx` ON `publisher_connections` (`project_id`,`connected_by_actor_id`);