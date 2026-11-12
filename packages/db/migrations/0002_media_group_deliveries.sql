-- Parent media containers are checkpointed separately from their ordered children.
-- Existing item-delivery identity and indexes remain unchanged.

-- postdot:common
CREATE TABLE "provider_media_group_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"execution_media_id" text NOT NULL,
	"publisher_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"state" text NOT NULL,
	"attempts" bigint DEFAULT 0 NOT NULL,
	"remote_media_id" text,
	"remote_media_url" text,
	"remote_media_expires_at" bigint,
	"last_attempt_at" bigint,
	"completed_at" bigint,
	"error_code" text,
	"error_message" text,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","execution_media_id") REFERENCES "publication_execution_revision_media"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","publisher_id") REFERENCES project_channel_publishers(project_id,publisher_id) ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "provider_media_group_deliveries_provider_nonblank" CHECK(length(trim("provider_media_group_deliveries"."provider_id")) > 0),
	CONSTRAINT "provider_media_group_deliveries_attempts_nonnegative" CHECK("provider_media_group_deliveries"."attempts" >= 0),
	CONSTRAINT "provider_media_group_deliveries_state_valid" CHECK("provider_media_group_deliveries"."state" in ('pending', 'uploading', 'uploaded', 'failed', 'ambiguous')),
	CONSTRAINT "provider_media_group_deliveries_timestamps_valid" CHECK(("provider_media_group_deliveries"."last_attempt_at" is null or "provider_media_group_deliveries"."last_attempt_at" >= "provider_media_group_deliveries"."created_at")
                and ("provider_media_group_deliveries"."completed_at" is null or "provider_media_group_deliveries"."completed_at" >= "provider_media_group_deliveries"."created_at")
                and ("provider_media_group_deliveries"."remote_media_expires_at" is null
                    or ("provider_media_group_deliveries"."completed_at" is not null and "provider_media_group_deliveries"."remote_media_expires_at" >= "provider_media_group_deliveries"."completed_at"))),
	CONSTRAINT "provider_media_group_deliveries_state_data_valid" CHECK(("provider_media_group_deliveries"."state" = 'pending'
                    and "provider_media_group_deliveries"."attempts" >= 0
                    and ("provider_media_group_deliveries"."last_attempt_at" is null or "provider_media_group_deliveries"."last_attempt_at" >= "provider_media_group_deliveries"."created_at")
                    and "provider_media_group_deliveries"."completed_at" is null
                    and "provider_media_group_deliveries"."remote_media_id" is null
                    and "provider_media_group_deliveries"."remote_media_url" is null
                    and "provider_media_group_deliveries"."remote_media_expires_at" is null
                    and "provider_media_group_deliveries"."error_code" is null
                    and "provider_media_group_deliveries"."error_message" is null)
                or ("provider_media_group_deliveries"."state" = 'uploading'
                    and "provider_media_group_deliveries"."attempts" > 0
                    and "provider_media_group_deliveries"."last_attempt_at" is not null
                    and "provider_media_group_deliveries"."completed_at" is null
                    and "provider_media_group_deliveries"."remote_media_expires_at" is null
                    and "provider_media_group_deliveries"."error_code" is null
                    and "provider_media_group_deliveries"."error_message" is null)
                or ("provider_media_group_deliveries"."state" = 'uploaded'
                    and "provider_media_group_deliveries"."attempts" > 0
                    and "provider_media_group_deliveries"."completed_at" is not null
                    and "provider_media_group_deliveries"."remote_media_id" is not null
                    and length(trim("provider_media_group_deliveries"."remote_media_id")) > 0
                    and ("provider_media_group_deliveries"."remote_media_expires_at" is null
                        or "provider_media_group_deliveries"."remote_media_expires_at" >= "provider_media_group_deliveries"."completed_at")
                    and "provider_media_group_deliveries"."error_code" is null
                    and "provider_media_group_deliveries"."error_message" is null)
                or ("provider_media_group_deliveries"."state" in ('failed', 'ambiguous')
                    and "provider_media_group_deliveries"."attempts" > 0
                    and "provider_media_group_deliveries"."completed_at" is not null
                    and "provider_media_group_deliveries"."remote_media_expires_at" is null
                    and "provider_media_group_deliveries"."error_code" is not null
                    and length(trim("provider_media_group_deliveries"."error_code")) > 0
                    and "provider_media_group_deliveries"."error_message" is not null
                    and length(trim("provider_media_group_deliveries"."error_message")) > 0)),
	CONSTRAINT "provider_media_group_deliveries_url_valid" CHECK("provider_media_group_deliveries"."remote_media_url" is null or length(trim("provider_media_group_deliveries"."remote_media_url")) > 0)
);

CREATE UNIQUE INDEX "provider_media_group_deliveries_execution_provider_uidx" ON "provider_media_group_deliveries" ("project_id","execution_media_id","publisher_id","provider_id");

CREATE UNIQUE INDEX "provider_media_group_deliveries_project_id_id_uidx" ON "provider_media_group_deliveries" ("project_id","id");

CREATE INDEX "provider_media_group_deliveries_project_state_idx" ON "provider_media_group_deliveries" ("project_id","state");

