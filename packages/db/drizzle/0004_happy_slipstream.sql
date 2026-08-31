PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_publisher_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`publisher_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`endpoint_url` text,
	`authentication_json` text,
	`connected_by_actor_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`publisher_id`) REFERENCES `publishers`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`credential_id`) REFERENCES `publisher_credentials`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`connected_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publisher_connections_endpoint_url_nonblank" CHECK("__new_publisher_connections"."endpoint_url" is null or length(trim("__new_publisher_connections"."endpoint_url")) > 0),
	CONSTRAINT "publisher_connections_authentication_json_object" CHECK("__new_publisher_connections"."authentication_json" is null or (json_valid("__new_publisher_connections"."authentication_json") and json_type("__new_publisher_connections"."authentication_json") = 'object'))
);
--> statement-breakpoint
INSERT INTO `__new_publisher_connections`("id", "project_id", "publisher_id", "credential_id", "endpoint_url", "authentication_json", "connected_by_actor_id", "created_at", "updated_at") SELECT "id", "project_id", "publisher_id", "credential_id", NULL, NULL, "connected_by_actor_id", "created_at", "updated_at" FROM `publisher_connections`;--> statement-breakpoint
DROP TABLE `publisher_connections`;--> statement-breakpoint
ALTER TABLE `__new_publisher_connections` RENAME TO `publisher_connections`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `publisher_connections_project_id_publisher_id_uidx` ON `publisher_connections` (`project_id`,`publisher_id`);--> statement-breakpoint
CREATE INDEX `publisher_connections_credential_id_idx` ON `publisher_connections` (`credential_id`);--> statement-breakpoint
CREATE INDEX `publisher_connections_project_id_actor_id_idx` ON `publisher_connections` (`project_id`,`connected_by_actor_id`);
