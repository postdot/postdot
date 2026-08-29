PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_publisher_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`publisher_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`connected_by_actor_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`publisher_id`) REFERENCES `publishers`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`credential_id`) REFERENCES `publisher_credentials`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`connected_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
-- Legacy publisher connections point at Better Auth accounts and cannot be
-- converted without decrypting provider tokens with the retired account key.
-- Abort before replacing the table instead of dropping those connections.
CREATE TABLE `__publisher_connections_migration_guard` (`id` integer);
--> statement-breakpoint
CREATE TRIGGER `publisher_connections_legacy_guard`
BEFORE INSERT ON `__publisher_connections_migration_guard`
WHEN EXISTS (SELECT 1 FROM `publisher_connections`)
BEGIN
	SELECT RAISE(ABORT, 'Legacy publisher connections require an explicit reconnect before migration');
END;
--> statement-breakpoint
INSERT INTO `__publisher_connections_migration_guard`("id")
VALUES (1);
--> statement-breakpoint
DELETE FROM `__publisher_connections_migration_guard` WHERE "id" = 1;
--> statement-breakpoint
DROP TRIGGER `publisher_connections_legacy_guard`;
--> statement-breakpoint
DROP TABLE `__publisher_connections_migration_guard`;
--> statement-breakpoint
DROP TABLE `publisher_connections`;--> statement-breakpoint
ALTER TABLE `__new_publisher_connections` RENAME TO `publisher_connections`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `publisher_connections_project_id_publisher_id_uidx` ON `publisher_connections` (`project_id`,`publisher_id`);--> statement-breakpoint
CREATE INDEX `publisher_connections_credential_id_idx` ON `publisher_connections` (`credential_id`);--> statement-breakpoint
CREATE INDEX `publisher_connections_project_id_actor_id_idx` ON `publisher_connections` (`project_id`,`connected_by_actor_id`);
