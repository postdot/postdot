PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_provider_analytics_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`provider` text NOT NULL,
	`subject_type` text NOT NULL,
	`provider_subject_id` text NOT NULL,
	`provider_subject_label` text,
	`provider_content_revision_id` text,
	`herald_entity_type` text,
	`herald_entity_id` text,
	`metric_name` text NOT NULL,
	`value` real,
	`unit` text NOT NULL,
	`aggregation` text NOT NULL,
	`reporting_period_start` integer,
	`reporting_period_end` integer,
	`observed_at` integer,
	`fetched_at` integer NOT NULL,
	`availability` text NOT NULL,
	`freshness` text NOT NULL,
	`provenance` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "provider_analytics_observations_provider_nonblank" CHECK(length(trim("__new_provider_analytics_observations"."provider")) > 0),
	CONSTRAINT "provider_analytics_observations_subject_id_nonblank" CHECK(length(trim("__new_provider_analytics_observations"."provider_subject_id")) > 0),
	CONSTRAINT "provider_analytics_observations_subject_label_nonblank" CHECK("__new_provider_analytics_observations"."provider_subject_label" is null or length(trim("__new_provider_analytics_observations"."provider_subject_label")) > 0),
	CONSTRAINT "provider_analytics_observations_content_revision_nonblank" CHECK("__new_provider_analytics_observations"."provider_content_revision_id" is null or length(trim("__new_provider_analytics_observations"."provider_content_revision_id")) > 0),
	CONSTRAINT "provider_analytics_observations_entity_pair_valid" CHECK(("__new_provider_analytics_observations"."herald_entity_type" is null and "__new_provider_analytics_observations"."herald_entity_id" is null)
                or ("__new_provider_analytics_observations"."herald_entity_type" is not null
                    and "__new_provider_analytics_observations"."herald_entity_id" is not null
                    and length(trim("__new_provider_analytics_observations"."herald_entity_id")) > 0)),
	CONSTRAINT "provider_analytics_observations_metric_nonblank" CHECK(length(trim("__new_provider_analytics_observations"."metric_name")) > 0),
	CONSTRAINT "provider_analytics_observations_unit_nonblank" CHECK(length(trim("__new_provider_analytics_observations"."unit")) > 0),
	CONSTRAINT "provider_analytics_observations_aggregation_nonblank" CHECK(length(trim("__new_provider_analytics_observations"."aggregation")) > 0),
	CONSTRAINT "provider_analytics_observations_provenance_nonblank" CHECK(length(trim("__new_provider_analytics_observations"."provenance")) > 0),
	CONSTRAINT "provider_analytics_observations_value_valid" CHECK("__new_provider_analytics_observations"."value" is null or ("__new_provider_analytics_observations"."value" >= 0 and "__new_provider_analytics_observations"."value" = "__new_provider_analytics_observations"."value")),
	CONSTRAINT "provider_analytics_observations_availability_value_valid" CHECK(("__new_provider_analytics_observations"."availability" = 'measured' and "__new_provider_analytics_observations"."value" is not null)
                or ("__new_provider_analytics_observations"."availability" <> 'measured' and "__new_provider_analytics_observations"."value" is null)),
	CONSTRAINT "provider_analytics_observations_period_valid" CHECK(("__new_provider_analytics_observations"."reporting_period_start" is null and "__new_provider_analytics_observations"."reporting_period_end" is null)
                or ("__new_provider_analytics_observations"."reporting_period_start" is not null
                    and "__new_provider_analytics_observations"."reporting_period_end" is not null
                    and "__new_provider_analytics_observations"."reporting_period_start" >= 0
                    and "__new_provider_analytics_observations"."reporting_period_end" > "__new_provider_analytics_observations"."reporting_period_start")),
	CONSTRAINT "provider_analytics_observations_timestamps_valid" CHECK(("__new_provider_analytics_observations"."observed_at" is null or "__new_provider_analytics_observations"."observed_at" >= 0)
                and "__new_provider_analytics_observations"."fetched_at" >= 0),
	CONSTRAINT "provider_analytics_observations_enum_valid" CHECK("__new_provider_analytics_observations"."subject_type" in ('account', 'content')
                and ("__new_provider_analytics_observations"."herald_entity_type" is null or "__new_provider_analytics_observations"."herald_entity_type" in ('channel', 'publication'))
                and "__new_provider_analytics_observations"."availability" in ('measured', 'not_reported', 'not_found', 'blocked', 'disabled', 'temporarily_unavailable', 'rate_limited', 'invalid_response', 'partial_response', 'not_configured', 'not_authorized', 'not_supported')
                and "__new_provider_analytics_observations"."freshness" in ('fresh', 'stale', 'unknown'))
);
--> statement-breakpoint
INSERT INTO `__new_provider_analytics_observations`("id", "project_id", "provider", "subject_type", "provider_subject_id", "provider_subject_label", "provider_content_revision_id", "herald_entity_type", "herald_entity_id", "metric_name", "value", "unit", "aggregation", "reporting_period_start", "reporting_period_end", "observed_at", "fetched_at", "availability", "freshness", "provenance") SELECT "id", "project_id", "provider", "subject_type", "provider_subject_id", "provider_subject_label", "provider_content_revision_id", "herald_entity_type", "herald_entity_id", "metric_name", "value", "unit", "aggregation", "reporting_period_start", "reporting_period_end", "observed_at", "fetched_at", "availability", "freshness", "provenance" FROM `provider_analytics_observations`;--> statement-breakpoint
DROP TABLE `provider_analytics_observations`;--> statement-breakpoint
ALTER TABLE `__new_provider_analytics_observations` RENAME TO `provider_analytics_observations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `provider_analytics_observations_project_id_id_uidx` ON `provider_analytics_observations` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_analytics_observations_snapshot_uidx` ON `provider_analytics_observations` (`project_id`,`provider`,`subject_type`,`provider_subject_id`,`metric_name`,`fetched_at`);--> statement-breakpoint
CREATE INDEX `provider_analytics_observations_project_subject_idx` ON `provider_analytics_observations` (`project_id`,`provider`,`subject_type`,`provider_subject_id`,`fetched_at`);--> statement-breakpoint
CREATE INDEX `provider_analytics_observations_project_entity_idx` ON `provider_analytics_observations` (`project_id`,`herald_entity_type`,`herald_entity_id`,`fetched_at`);