CREATE TABLE `user_avatars` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`state` text NOT NULL,
	`store_id` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "user_avatars_state_valid" CHECK("user_avatars"."state" in ('pending', 'ready', 'retired')),
	CONSTRAINT "user_avatars_size_valid" CHECK("user_avatars"."byte_size" > 0 and "user_avatars"."byte_size" <= 5242880)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_avatars_object_key_unique` ON `user_avatars` (`object_key`);--> statement-breakpoint
CREATE INDEX `user_avatars_owner_state` ON `user_avatars` (`user_id`,`state`);