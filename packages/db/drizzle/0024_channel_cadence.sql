CREATE TABLE `channel_cadence` (
	`channel_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`time_zone` text NOT NULL,
	`daily_max` integer,
	`weekly_max` integer,
	`minimum_interval_ms` integer,
	`last_effect_at` integer,
	`updated_by_actor_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "channel_cadence_revision" CHECK("channel_cadence"."revision" > 0),
	CONSTRAINT "channel_cadence_daily" CHECK("channel_cadence"."daily_max" > 0),
	CONSTRAINT "channel_cadence_weekly" CHECK("channel_cadence"."weekly_max" > 0),
	CONSTRAINT "channel_cadence_interval" CHECK("channel_cadence"."minimum_interval_ms" > 0)
);
--> statement-breakpoint
CREATE TABLE `publication_cadence_overrides` (
	`publication_id` text PRIMARY KEY NOT NULL,
	`rules_revision` integer NOT NULL,
	`scheduled_at` integer NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`publication_id`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `publications_channel_state_published_at_idx` ON `publications` (`channel_id`,`state`,`published_at`);--> statement-breakpoint
-- Drizzle Kit splits commas in SQLite expression indexes; retain the expression as SQL.
CREATE INDEX `publications_channel_planning_at_idx` ON `publications` (`channel_id`, coalesce(`published_at`, `scheduled_at`, `updated_at`));
