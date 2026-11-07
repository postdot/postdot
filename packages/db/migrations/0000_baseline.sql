-- Postdot portable baseline (ADR-097 §6). Schema equivalent to the historical
-- SQLite chain 0000-0027. Sections run in file order; `common` runs on every
-- engine, `sqlite`/`postgres` only on that engine. Keep this file reviewed by
-- hand: there is no generator.

-- postdot:postgres
-- Compatibility layer so the common DDL below is valid on PostgreSQL: SQLite's
-- `blob` type and the SQLite functions used by defaults and CHECK constraints.
create domain blob as bytea;

create function unixepoch(modifier text default null) returns double precision
language sql volatile as $$
    select case when modifier = 'subsecond'
        then extract(epoch from clock_timestamp())::double precision
        else floor(extract(epoch from clock_timestamp()))::double precision end
$$;

create function json_valid(value text) returns boolean
language plpgsql immutable as $$
begin
    if value is null then return null; end if;
    perform value::jsonb;
    return true;
exception when others then
    return false;
end
$$;

-- SQLite json_type(): object, array, text, integer, real, true, false, null.
create function json_type(value text) returns text
language sql immutable as $$
    select case jsonb_typeof(value::jsonb)
        when 'object' then 'object'
        when 'array' then 'array'
        when 'string' then 'text'
        when 'boolean' then value::jsonb::text
        when 'null' then 'null'
        when 'number' then case when value::jsonb::text ~ '^-?[0-9]+$' then 'integer' else 'real' end
    end
$$;

create function instr(haystack text, needle text) returns integer
language sql immutable as $$ select strpos(haystack, needle) $$;

-- postdot:common
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" bigint DEFAULT 0 NOT NULL,
	"image" text,
	"role" text,
	"banned" bigint DEFAULT 0,
	"ban_reason" text,
	"ban_expires" bigint,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL
);

CREATE UNIQUE INDEX "user_email_unique" ON "user" ("email");

CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" bigint,
	"refresh_token_expires_at" bigint,
	"scope" text,
	"password" text,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint NOT NULL,
	FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE
);

CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "account" ("issuer","account_id");

CREATE INDEX "account_userId_idx" ON "account" ("user_id");

CREATE TABLE "project_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"archived_at" bigint,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	CONSTRAINT "project_categories_name_nonblank" CHECK(length(trim("project_categories"."name")) > 0),
	CONSTRAINT "project_categories_normalized_name_nonblank" CHECK(length(trim("project_categories"."normalized_name")) > 0),
	CONSTRAINT "project_categories_name_length_valid" CHECK(length("project_categories"."name") <= 120 and length("project_categories"."normalized_name") <= 120),
	CONSTRAINT "project_categories_state_valid" CHECK("project_categories"."state" in ('active', 'archived')),
	CONSTRAINT "project_categories_archived_timestamp_valid" CHECK(("project_categories"."state" = 'active' and "project_categories"."archived_at" is null)
                or ("project_categories"."state" = 'archived' and "project_categories"."archived_at" is not null))
);

CREATE UNIQUE INDEX "project_categories_normalized_name_uidx" ON "project_categories" ("normalized_name");

CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"metadata" text
);

CREATE INDEX "organization_slug_idx" ON "organization" ("slug");

CREATE UNIQUE INDEX "organization_slug_unique" ON "organization" ("slug");

CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_default" bigint DEFAULT 0 NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "workspaces_name_nonblank" CHECK(length(trim("workspaces"."name")) > 0),
	CONSTRAINT "workspaces_slug_nonblank" CHECK(length(trim("workspaces"."slug")) > 0)
);

CREATE UNIQUE INDEX "workspaces_organization_id_uidx" ON "workspaces" ("organization_id");

CREATE UNIQUE INDEX "workspaces_slug_uidx" ON "workspaces" ("slug");

CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"workspace_id" text,
	"primary_category_id" text,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("primary_category_id") REFERENCES "project_categories"("id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "projects_name_nonblank" CHECK(length(trim("projects"."name")) > 0)
);

CREATE UNIQUE INDEX projects_workspace_id_id_uidx ON projects(workspace_id,id);

CREATE TABLE "actors" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"workspace_id" text,
	"origin_actor_id" text,
	"kind" text NOT NULL,
	"subject_id" text,
	"display_name" text NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "actors_scope_valid" CHECK(("actors"."project_id" is not null and "actors"."workspace_id" is null and "actors"."origin_actor_id" is null) or ("actors"."project_id" is null and "actors"."workspace_id" is not null)),
	CONSTRAINT "actors_origin_nonblank" CHECK("actors"."origin_actor_id" is null or length(trim("actors"."origin_actor_id")) > 0),
	CONSTRAINT "actors_kind_valid" CHECK("actors"."kind" in ('human', 'agent', 'api_token', 'system')),
	CONSTRAINT "actors_display_name_nonblank" CHECK(length(trim("actors"."display_name")) > 0),
	CONSTRAINT "actors_subject_id_nonblank" CHECK("actors"."subject_id" is null or length(trim("actors"."subject_id")) > 0)
);

CREATE UNIQUE INDEX "actors_project_id_id_uidx" ON "actors" ("project_id","id");

CREATE UNIQUE INDEX "actors_workspace_id_id_uidx" ON "actors" ("workspace_id","id");

CREATE UNIQUE INDEX "actors_workspace_origin_uidx" ON "actors" ("workspace_id","origin_actor_id");

CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"reference_id" text NOT NULL,
	"prefix" text,
	"key" text NOT NULL,
	"refill_interval" bigint,
	"refill_amount" bigint,
	"last_refill_at" bigint,
	"enabled" bigint DEFAULT 1,
	"rate_limit_enabled" bigint DEFAULT 1,
	"rate_limit_time_window" bigint DEFAULT 86400000,
	"rate_limit_max" bigint DEFAULT 10,
	"request_count" bigint DEFAULT 0,
	"remaining" bigint,
	"last_request" bigint,
	"expires_at" bigint,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"permissions" text,
	"metadata" text
);

CREATE INDEX "apikey_config_id_idx" ON "apikey" ("config_id");

CREATE INDEX "apikey_key_idx" ON "apikey" ("key");

CREATE INDEX "apikey_reference_id_idx" ON "apikey" ("reference_id");

-- postdot:sqlite
CREATE TABLE "audit_events" (
	"sequence" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"id" text NOT NULL,
	"project_id" text,
	"workspace_id" text,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"metadata_json" text,
	"event_version" bigint DEFAULT 1 NOT NULL,
	"correlation_id" text,
	"causation_id" text,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("workspace_id","actor_id") REFERENCES "actors"("workspace_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","actor_id") REFERENCES "actors"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "audit_events_scope_valid" CHECK(("audit_events"."project_id" is not null and "audit_events"."workspace_id" is null) or ("audit_events"."project_id" is null and "audit_events"."workspace_id" is not null)),
	CONSTRAINT "audit_events_action_nonblank" CHECK(length(trim("audit_events"."action")) > 0),
	CONSTRAINT "audit_events_entity_type_nonblank" CHECK(length(trim("audit_events"."entity_type")) > 0),
	CONSTRAINT "audit_events_entity_id_nonblank" CHECK(length(trim("audit_events"."entity_id")) > 0),
	CONSTRAINT "audit_events_event_version_valid" CHECK("audit_events"."event_version" > 0),
	CONSTRAINT "audit_events_metadata_json_valid" CHECK("audit_events"."metadata_json" is null or (json_valid("audit_events"."metadata_json") and json_type("audit_events"."metadata_json") = 'object')),
	CONSTRAINT "audit_events_correlation_id_nonblank" CHECK("audit_events"."correlation_id" is null or length(trim("audit_events"."correlation_id")) > 0),
	CONSTRAINT "audit_events_causation_id_nonblank" CHECK("audit_events"."causation_id" is null or length(trim("audit_events"."causation_id")) > 0)
);

-- postdot:postgres
CREATE TABLE "audit_events" (
	"sequence" bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"project_id" text,
	"workspace_id" text,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"metadata_json" text,
	"event_version" bigint DEFAULT 1 NOT NULL,
	"correlation_id" text,
	"causation_id" text,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("workspace_id","actor_id") REFERENCES "actors"("workspace_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","actor_id") REFERENCES "actors"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "audit_events_scope_valid" CHECK(("audit_events"."project_id" is not null and "audit_events"."workspace_id" is null) or ("audit_events"."project_id" is null and "audit_events"."workspace_id" is not null)),
	CONSTRAINT "audit_events_action_nonblank" CHECK(length(trim("audit_events"."action")) > 0),
	CONSTRAINT "audit_events_entity_type_nonblank" CHECK(length(trim("audit_events"."entity_type")) > 0),
	CONSTRAINT "audit_events_entity_id_nonblank" CHECK(length(trim("audit_events"."entity_id")) > 0),
	CONSTRAINT "audit_events_event_version_valid" CHECK("audit_events"."event_version" > 0),
	CONSTRAINT "audit_events_metadata_json_valid" CHECK("audit_events"."metadata_json" is null or (json_valid("audit_events"."metadata_json") and json_type("audit_events"."metadata_json") = 'object')),
	CONSTRAINT "audit_events_correlation_id_nonblank" CHECK("audit_events"."correlation_id" is null or length(trim("audit_events"."correlation_id")) > 0),
	CONSTRAINT "audit_events_causation_id_nonblank" CHECK("audit_events"."causation_id" is null or length(trim("audit_events"."causation_id")) > 0)
);

-- postdot:common
CREATE UNIQUE INDEX "audit_events_id_uidx" ON "audit_events" ("id");

CREATE INDEX "audit_events_project_id_created_at_idx" ON "audit_events" ("project_id","created_at");

CREATE INDEX "audit_events_project_id_entity_idx" ON "audit_events" ("project_id","entity_type","entity_id");

CREATE UNIQUE INDEX "audit_events_project_id_id_uidx" ON "audit_events" ("project_id","id");

CREATE INDEX "audit_events_project_id_sequence_idx" ON "audit_events" ("project_id","sequence");

CREATE INDEX "audit_events_workspace_sequence_idx" ON "audit_events" ("workspace_id","sequence");

CREATE TABLE "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"profile_version_id" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"archived_at" bigint,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL, "destination_revision" bigint DEFAULT 0 NOT NULL, "destination_identity_json" text,
	FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "channels_profile_version_id_nonblank" CHECK(length(trim("channels"."profile_version_id")) > 0),
	CONSTRAINT "channels_name_nonblank" CHECK(length(trim("channels"."name")) > 0),
	CONSTRAINT "channels_state_valid" CHECK("channels"."state" in ('active', 'archived')),
	CONSTRAINT "channels_archived_timestamp_valid" CHECK(("channels"."state" = 'active' and "channels"."archived_at" is null)
                or ("channels"."state" = 'archived' and "channels"."archived_at" is not null)),
	CONSTRAINT "channels_revision_positive" CHECK("channels"."revision" > 0)
);

CREATE UNIQUE INDEX "channels_workspace_id_id_uidx" ON "channels" ("workspace_id","id");

CREATE TABLE "channel_cadence" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"revision" bigint NOT NULL,
	"time_zone" text NOT NULL,
	"daily_max" bigint,
	"weekly_max" bigint,
	"minimum_interval_ms" bigint,
	"last_effect_at" bigint,
	"updated_by_actor_id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("updated_by_actor_id") REFERENCES "actors"("id") ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "channel_cadence_revision" CHECK("channel_cadence"."revision" > 0),
	CONSTRAINT "channel_cadence_daily" CHECK("channel_cadence"."daily_max" > 0),
	CONSTRAINT "channel_cadence_weekly" CHECK("channel_cadence"."weekly_max" > 0),
	CONSTRAINT "channel_cadence_interval" CHECK("channel_cadence"."minimum_interval_ms" > 0)
);

CREATE TABLE project_channel_attachments (
 project_id text NOT NULL, channel_id text NOT NULL, workspace_id text NOT NULL,
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','detached')),
 origin text NOT NULL CHECK(origin IN ('migrated','explicit')),
 attached_by_actor_id text, attached_at bigint NOT NULL, detached_at bigint,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 PRIMARY KEY(project_id,channel_id),
 FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id) ON DELETE NO ACTION,
 FOREIGN KEY(workspace_id,channel_id) REFERENCES channels(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,attached_by_actor_id) REFERENCES actors(workspace_id,id) ON DELETE RESTRICT,
 CHECK((state='active' AND detached_at IS NULL) OR (state='detached' AND detached_at IS NOT NULL)),
 CHECK((origin='migrated' AND attached_by_actor_id IS NULL) OR (origin='explicit' AND attached_by_actor_id IS NOT NULL))
);

CREATE INDEX project_channel_attachments_channel_state_idx ON project_channel_attachments(channel_id,state,project_id);

CREATE TABLE channel_managers (channel_id text PRIMARY KEY NOT NULL, project_id text NOT NULL, workspace_id text NOT NULL,
 FOREIGN KEY(project_id,channel_id) REFERENCES project_channel_attachments(project_id,channel_id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,channel_id) REFERENCES channels(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id) ON DELETE CASCADE);

CREATE INDEX channel_managers_workspace_project_idx ON channel_managers(workspace_id,project_id);

CREATE TABLE "channel_profile_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"version" bigint NOT NULL,
	"origin" text NOT NULL,
	"state" text NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"profile_json" text NOT NULL,
	"profile_hash" text NOT NULL,
	"schema_hash" text NOT NULL,
	"created_by_actor_id" text NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("workspace_id","channel_id") REFERENCES "channels"("workspace_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("workspace_id","created_by_actor_id") REFERENCES "actors"("workspace_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "channel_profile_versions_profile_id_nonblank" CHECK(length(trim("channel_profile_versions"."profile_id")) > 0),
	CONSTRAINT "channel_profile_versions_version_positive" CHECK("channel_profile_versions"."version" > 0),
	CONSTRAINT "channel_profile_versions_revision_positive" CHECK("channel_profile_versions"."revision" > 0),
	CONSTRAINT "channel_profile_versions_profile_json_object" CHECK(json_valid("channel_profile_versions"."profile_json") and json_type("channel_profile_versions"."profile_json") = 'object'),
	CONSTRAINT "channel_profile_versions_hashes_nonblank" CHECK(length(trim("channel_profile_versions"."profile_hash")) > 0 and length(trim("channel_profile_versions"."schema_hash")) > 0),
	CONSTRAINT "channel_profile_versions_origin_valid" CHECK("channel_profile_versions"."origin" in ('built_in', 'custom')),
	CONSTRAINT "channel_profile_versions_state_valid" CHECK("channel_profile_versions"."state" in ('draft', 'active', 'superseded', 'disabled'))
);

CREATE UNIQUE INDEX "channel_profile_versions_workspace_channel_active_uidx" ON "channel_profile_versions" ("workspace_id","channel_id") WHERE "channel_profile_versions"."state" = 'active';

CREATE UNIQUE INDEX "channel_profile_versions_workspace_channel_draft_uidx" ON "channel_profile_versions" ("workspace_id","channel_id") WHERE "channel_profile_versions"."state" = 'draft';

CREATE INDEX "channel_profile_versions_workspace_channel_state_idx" ON "channel_profile_versions" ("workspace_id","channel_id","state");

CREATE UNIQUE INDEX "channel_profile_versions_workspace_channel_version_uidx" ON "channel_profile_versions" ("workspace_id","channel_id","version");

CREATE UNIQUE INDEX "channel_profile_versions_workspace_id_id_uidx" ON "channel_profile_versions" ("workspace_id","id");

CREATE UNIQUE INDEX channel_profiles_channel_id_id_uidx ON channel_profile_versions(channel_id,id);

CREATE TABLE "installation_email_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"encryption_version" bigint NOT NULL,
	"encryption_key_id" text NOT NULL,
	"nonce" blob NOT NULL,
	"ciphertext" blob NOT NULL,
	"updated_at" bigint NOT NULL
);

CREATE TABLE "instance_access_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"target_email" text NOT NULL,
	"token_hash" text NOT NULL,
	"instance_role" text DEFAULT 'member' NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"accepted_at" bigint,
	"accepted_by_user_id" text,
	"revoked_at" bigint,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("accepted_by_user_id") REFERENCES "user"("id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "instance_access_invitations_email_nonblank" CHECK(length(trim("instance_access_invitations"."target_email")) > 0),
	CONSTRAINT "instance_access_invitations_token_hash_nonblank" CHECK(length(trim("instance_access_invitations"."token_hash")) > 0),
	CONSTRAINT "instance_access_invitations_instance_role_valid" CHECK("instance_access_invitations"."instance_role" = 'member'),
	CONSTRAINT "instance_access_invitations_state_valid" CHECK(("instance_access_invitations"."state" = 'pending' and "instance_access_invitations"."accepted_at" is null and "instance_access_invitations"."accepted_by_user_id" is null and "instance_access_invitations"."revoked_at" is null)
                or ("instance_access_invitations"."state" = 'accepted' and "instance_access_invitations"."accepted_at" is not null and "instance_access_invitations"."accepted_by_user_id" is not null and "instance_access_invitations"."revoked_at" is null)
                or ("instance_access_invitations"."state" = 'revoked' and "instance_access_invitations"."accepted_at" is null and "instance_access_invitations"."accepted_by_user_id" is null and "instance_access_invitations"."revoked_at" is not null)
                or ("instance_access_invitations"."state" = 'expired' and "instance_access_invitations"."accepted_at" is null and "instance_access_invitations"."accepted_by_user_id" is null and "instance_access_invitations"."revoked_at" is null)),
	CONSTRAINT "instance_access_invitations_expiry_valid" CHECK("instance_access_invitations"."expires_at" > "instance_access_invitations"."created_at")
);

CREATE INDEX "instance_access_invitations_expiry_idx" ON "instance_access_invitations" ("state","expires_at");

CREATE INDEX "instance_access_invitations_target_state_idx" ON "instance_access_invitations" ("target_email","state");

CREATE UNIQUE INDEX "instance_access_invitations_token_hash_uidx" ON "instance_access_invitations" ("token_hash");

CREATE TABLE "instance_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"state" text DEFAULT 'enabled' NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "instance_memberships_role_valid" CHECK("instance_memberships"."role" in ('admin', 'member')),
	CONSTRAINT "instance_memberships_state_valid" CHECK("instance_memberships"."state" in ('enabled', 'disabled'))
);

CREATE UNIQUE INDEX "instance_memberships_user_uidx" ON "instance_memberships" ("user_id");

CREATE TABLE "instance_state" (
	"id" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"bootstrap_blocked" bigint DEFAULT 0 NOT NULL,
	"claimed_by_user_id" text,
	"claimed_at" bigint,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL, "default_workspace_id" text REFERENCES workspaces(id),
	FOREIGN KEY ("claimed_by_user_id") REFERENCES "user"("id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "instance_state_singleton" CHECK("instance_state"."id" = 'default'),
	CONSTRAINT "instance_state_value_valid" CHECK("instance_state"."state" in ('claimable', 'claimed')),
	CONSTRAINT "instance_state_bootstrap_block_valid" CHECK("instance_state"."bootstrap_blocked" = 0 or "instance_state"."state" = 'claimable'),
	CONSTRAINT "instance_state_claim_consistency" CHECK(("instance_state"."state" = 'claimable' and "instance_state"."claimed_by_user_id" is null and "instance_state"."claimed_at" is null)
                or ("instance_state"."state" = 'claimed' and "instance_state"."claimed_by_user_id" is not null and "instance_state"."claimed_at" is not null))
);

CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"inviter_id" text NOT NULL, "team_id" text, "project_id" text, "project_role" text,
	FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("inviter_id") REFERENCES "user"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX "invitation_email_idx" ON "invitation" ("email");

CREATE INDEX "invitation_organization_id_idx" ON "invitation" ("organization_id");

CREATE INDEX "invitation_team_id_idx" ON "invitation" ("team_id");

CREATE TABLE "posts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"title" text,
	"source_content" text NOT NULL,
	"source_revision" bigint DEFAULT 1 NOT NULL,
	"created_by_actor_id" text NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","created_by_actor_id") REFERENCES "actors"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "posts_title_nonblank" CHECK("posts"."title" is null or length(trim("posts"."title")) > 0),
	CONSTRAINT "posts_source_content_object" CHECK(json_valid("posts"."source_content") and json_type("posts"."source_content") = 'object'),
	CONSTRAINT "posts_source_revision_positive" CHECK("posts"."source_revision" > 0)
);

CREATE INDEX "posts_project_id_created_by_actor_id_idx" ON "posts" ("project_id","created_by_actor_id");

CREATE UNIQUE INDEX "posts_project_id_id_uidx" ON "posts" ("project_id","id");

CREATE TABLE project_channel_profiles (project_id text NOT NULL, channel_id text NOT NULL, profile_id text NOT NULL,
 PRIMARY KEY(project_id,profile_id),
 FOREIGN KEY(project_id,channel_id) REFERENCES project_channel_attachments(project_id,channel_id) ON DELETE CASCADE,
 FOREIGN KEY(channel_id,profile_id) REFERENCES channel_profile_versions(channel_id,id) ON DELETE CASCADE);

CREATE TABLE "publications" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"post_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"target_revision_id" text,
	"delivery_mode" text NOT NULL,
	"review_state" text NOT NULL,
	"state" text NOT NULL,
	"scheduled_at" bigint,
	"published_at" bigint,
	"external_id" text,
	"external_url" text,
	"error_message" text,
	"created_by_actor_id" text NOT NULL,
	"scheduled_by_actor_id" text,
	"state_changed_by_actor_id" text NOT NULL,
	"published_by_actor_id" text,
	"last_assessed_profile_version_id" text,
	"profile_assessment_issues_json" text DEFAULT '[]' NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL, "confirmed_destination_revision" bigint DEFAULT 0 NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","post_id") REFERENCES "posts"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","channel_id") REFERENCES project_channel_attachments(project_id,channel_id) ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","created_by_actor_id") REFERENCES "actors"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","scheduled_by_actor_id") REFERENCES "actors"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","state_changed_by_actor_id") REFERENCES "actors"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","published_by_actor_id") REFERENCES "actors"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","last_assessed_profile_version_id") REFERENCES project_channel_profiles(project_id,profile_id) ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "publications_target_revision_id_nonblank" CHECK("publications"."target_revision_id" is null or length(trim("publications"."target_revision_id")) > 0),
	CONSTRAINT "publications_delivery_mode_valid" CHECK("publications"."delivery_mode" in ('manual', 'automatic')),
	CONSTRAINT "publications_review_state_valid" CHECK("publications"."review_state" in ('compatible', 'review_required')),
	CONSTRAINT "publications_profile_assessment_issues_array" CHECK(json_valid("publications"."profile_assessment_issues_json") and json_type("publications"."profile_assessment_issues_json") = 'array'),
	CONSTRAINT "publications_scheduled_target_valid" CHECK("publications"."state" <> 'scheduled' or "publications"."target_revision_id" is not null),
	CONSTRAINT "publications_state_valid" CHECK("publications"."state" in ('draft', 'scheduled', 'ready', 'publishing', 'published', 'failed', 'ambiguous', 'cancelled')),
	CONSTRAINT "publications_schedule_consistent" CHECK(("publications"."scheduled_at" is null and "publications"."scheduled_by_actor_id" is null) or ("publications"."scheduled_at" is not null and "publications"."scheduled_by_actor_id" is not null)),
	CONSTRAINT "publications_scheduled_state_has_time" CHECK("publications"."state" <> 'scheduled' or "publications"."scheduled_at" is not null),
	CONSTRAINT "publications_published_state_complete" CHECK("publications"."state" <> 'published' or ("publications"."published_at" is not null and "publications"."published_by_actor_id" is not null)),
	CONSTRAINT "publications_unpublished_state_has_no_result" CHECK("publications"."state" = 'published' or ("publications"."published_at" is null and "publications"."published_by_actor_id" is null)),
	CONSTRAINT "publications_failure_has_error" CHECK("publications"."state" not in ('failed', 'ambiguous') or ("publications"."error_message" is not null and length(trim("publications"."error_message")) > 0)),
	CONSTRAINT "publications_nonfailure_has_no_error" CHECK("publications"."state" in ('failed', 'ambiguous') or "publications"."error_message" is null)
);

CREATE INDEX "publications_channel_planning_at_idx" ON "publications" ("channel_id", coalesce("published_at", "scheduled_at", "updated_at"));

CREATE INDEX "publications_channel_state_published_at_idx" ON "publications" ("channel_id","state","published_at");

CREATE INDEX "publications_project_id_channel_id_idx" ON "publications" ("project_id","channel_id");

CREATE INDEX "publications_project_id_created_by_actor_id_idx" ON "publications" ("project_id","created_by_actor_id");

CREATE UNIQUE INDEX "publications_project_id_id_uidx" ON "publications" ("project_id","id");

CREATE INDEX "publications_project_id_post_id_idx" ON "publications" ("project_id","post_id");

CREATE INDEX "publications_project_id_published_by_actor_id_idx" ON "publications" ("project_id","published_by_actor_id");

CREATE INDEX "publications_project_id_scheduled_by_actor_id_idx" ON "publications" ("project_id","scheduled_by_actor_id");

CREATE INDEX "publications_project_id_state_changed_by_actor_id_idx" ON "publications" ("project_id","state_changed_by_actor_id");

CREATE INDEX "publications_state_scheduled_at_idx" ON "publications" ("state","scheduled_at");

CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"publication_id" text NOT NULL,
	"state" text NOT NULL,
	"run_at" bigint NOT NULL,
	"attempts" bigint DEFAULT 0 NOT NULL,
	"claim_token" text,
	"claimed_by_actor_id" text,
	"claimed_at" bigint,
	"lease_expires_at" bigint,
	"effect_started_at" bigint,
	"started_at" bigint,
	"completed_at" bigint,
	"error_message" text,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","publication_id") REFERENCES "publications"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","claimed_by_actor_id") REFERENCES "actors"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "jobs_state_valid" CHECK("jobs"."state" in ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "jobs_attempts_nonnegative" CHECK("jobs"."attempts" >= 0),
	CONSTRAINT "jobs_running_has_started" CHECK("jobs"."state" <> 'running' or ("jobs"."claim_token" is not null and length(trim("jobs"."claim_token")) > 0 and "jobs"."claimed_by_actor_id" is not null and "jobs"."claimed_at" is not null and "jobs"."lease_expires_at" is not null and "jobs"."started_at" is not null and "jobs"."completed_at" is null and "jobs"."error_message" is null)),
	CONSTRAINT "jobs_pending_is_clean" CHECK("jobs"."state" <> 'pending' or ("jobs"."claim_token" is null and "jobs"."claimed_by_actor_id" is null and "jobs"."claimed_at" is null and "jobs"."lease_expires_at" is null and "jobs"."effect_started_at" is null and "jobs"."started_at" is null and "jobs"."completed_at" is null and "jobs"."error_message" is null)),
	CONSTRAINT "jobs_nonrunning_has_no_fence" CHECK("jobs"."state" = 'running' or ("jobs"."claim_token" is null and "jobs"."lease_expires_at" is null)),
	CONSTRAINT "jobs_lease_after_claim" CHECK("jobs"."lease_expires_at" is null or ("jobs"."claimed_at" is not null and "jobs"."lease_expires_at" > "jobs"."claimed_at")),
	CONSTRAINT "jobs_effect_after_claim" CHECK("jobs"."effect_started_at" is null or ("jobs"."claimed_at" is not null and "jobs"."effect_started_at" >= "jobs"."claimed_at")),
	CONSTRAINT "jobs_terminal_has_completed" CHECK("jobs"."state" not in ('succeeded', 'failed', 'cancelled') or "jobs"."completed_at" is not null),
	CONSTRAINT "jobs_failed_has_error" CHECK("jobs"."state" <> 'failed' or ("jobs"."error_message" is not null and length(trim("jobs"."error_message")) > 0)),
	CONSTRAINT "jobs_completed_attempt_has_started" CHECK("jobs"."state" not in ('succeeded', 'failed') or "jobs"."started_at" is not null)
);

CREATE INDEX "jobs_project_id_claimed_by_actor_id_idx" ON "jobs" ("project_id","claimed_by_actor_id");

CREATE UNIQUE INDEX "jobs_project_id_id_uidx" ON "jobs" ("project_id","id");

CREATE INDEX "jobs_project_id_publication_id_idx" ON "jobs" ("project_id","publication_id");

CREATE UNIQUE INDEX "jobs_project_publication_active_uidx" ON "jobs" ("project_id","publication_id") WHERE "jobs"."state" in ('pending', 'running');

CREATE INDEX "jobs_state_lease_expires_at_idx" ON "jobs" ("state","lease_expires_at");

CREATE INDEX "jobs_state_run_at_idx" ON "jobs" ("state","run_at");

CREATE TABLE "media_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"original_filename" text NOT NULL,
	"default_accessibility_text" text,
	"state" text NOT NULL,
	"archived_at" bigint,
	"deletion_requested_at" bigint,
	"deleted_at" bigint,
	"failure_code" text,
	"failure_message" text,
	"created_by_actor_id" text NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL, "deletion_restore_state" text, "deletion_restore_failure_code" text, "deletion_restore_failure_message" text,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","created_by_actor_id") REFERENCES "actors"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "media_assets_filename_valid" CHECK(length(trim("media_assets"."original_filename")) > 0 and length("media_assets"."original_filename") <= 255),
	CONSTRAINT "media_assets_accessibility_text_valid" CHECK("media_assets"."default_accessibility_text" is null or length(trim("media_assets"."default_accessibility_text")) > 0),
	CONSTRAINT "media_assets_state_valid" CHECK("media_assets"."state" in ('reserved', 'stored', 'inspecting', 'ready', 'failed', 'deletion_requested', 'deleted')),
	CONSTRAINT "media_assets_failure_valid" CHECK(("media_assets"."state" = 'failed'
                    and "media_assets"."failure_code" is not null
                    and length(trim("media_assets"."failure_code")) > 0
                    and "media_assets"."failure_message" is not null
                    and length(trim("media_assets"."failure_message")) > 0)
                or ("media_assets"."state" <> 'failed'
                    and "media_assets"."failure_code" is null
                    and "media_assets"."failure_message" is null)),
	CONSTRAINT "media_assets_deletion_timestamps_valid" CHECK((("media_assets"."state" in ('deletion_requested', 'deleted')
                    and "media_assets"."deletion_requested_at" is not null)
                or ("media_assets"."state" not in ('deletion_requested', 'deleted')
                    and "media_assets"."deletion_requested_at" is null))
                and (("media_assets"."state" = 'deleted'
                    and "media_assets"."deleted_at" is not null
                    or "media_assets"."state" <> 'deleted'
                    and "media_assets"."deleted_at" is null))),
	CONSTRAINT "media_assets_archived_timestamp_valid" CHECK("media_assets"."archived_at" is null or "media_assets"."archived_at" >= "media_assets"."created_at")
);

CREATE UNIQUE INDEX "media_assets_project_id_id_uidx" ON "media_assets" ("project_id","id");

CREATE INDEX "media_assets_project_state_idx" ON "media_assets" ("project_id","state");

CREATE INDEX "media_assets_project_trash_idx" ON "media_assets" ("project_id","deletion_requested_at") WHERE "media_assets"."state" = 'deletion_requested';

CREATE TABLE "media_backup_fences" (
	"id" bigint PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	CONSTRAINT "media_backup_fences_singleton" CHECK("media_backup_fences"."id" = 1),
	CONSTRAINT "media_backup_fences_owner_nonblank" CHECK(length(trim("media_backup_fences"."owner_id")) > 0),
	CONSTRAINT "media_backup_fences_expiry_valid" CHECK("media_backup_fences"."expires_at" > "media_backup_fences"."created_at")
);

-- postdot:sqlite
CREATE TABLE "media_representations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"kind" text NOT NULL,
	"source_representation_id" text,
	"state" text NOT NULL,
	"store_id" text NOT NULL,
	"object_key" text NOT NULL,
	"declared_content_type" text,
	"detected_content_type" text,
	"detected_format" text,
	"family" text,
	"byte_size" bigint,
	"sha256" text,
	"width" bigint,
	"height" bigint,
	"duration_ms" bigint,
	"page_count" bigint,
	"is_animated" bigint,
	"processor_id" text,
	"processor_version" text,
	"recipe_json" text,
	"failure_code" text,
	"failure_message" text,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL, "deletion_restore_state" text, "deletion_restore_failure_code" text, "deletion_restore_failure_message" text,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","asset_id") REFERENCES "media_assets"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","asset_id","source_representation_id") REFERENCES "media_representations"("project_id","asset_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "media_representations_kind_valid" CHECK("media_representations"."kind" in ('original', 'derived')),
	CONSTRAINT "media_representations_state_valid" CHECK("media_representations"."state" in ('reserved', 'stored', 'inspecting', 'ready', 'failed', 'deletion_requested', 'deleted')),
	CONSTRAINT "media_representations_store_locator_valid" CHECK(length(trim("media_representations"."store_id")) > 0
                and length(trim("media_representations"."object_key")) > 0
                and length("media_representations"."object_key") <= 1024),
	CONSTRAINT "media_representations_declared_type_valid" CHECK("media_representations"."declared_content_type" is null or length(trim("media_representations"."declared_content_type")) > 0),
	CONSTRAINT "media_representations_dimensions_valid" CHECK(("media_representations"."width" is null or "media_representations"."width" > 0)
                and ("media_representations"."height" is null or "media_representations"."height" > 0)
                and ("media_representations"."duration_ms" is null or "media_representations"."duration_ms" >= 0)
                and ("media_representations"."page_count" is null or "media_representations"."page_count" > 0)),
	CONSTRAINT "media_representations_hash_valid" CHECK("media_representations"."sha256" is null or length("media_representations"."sha256") = 64),
	CONSTRAINT "media_representations_family_valid" CHECK("media_representations"."family" is null or "media_representations"."family" in ('image', 'video', 'audio', 'document')),
	CONSTRAINT "media_representations_ready_facts_valid" CHECK("media_representations"."state" <> 'ready'
                or ("media_representations"."detected_content_type" is not null
                    and "media_representations"."detected_format" is not null
                    and "media_representations"."family" is not null
                    and "media_representations"."byte_size" is not null
                    and "media_representations"."sha256" is not null)),
	CONSTRAINT "media_representations_failure_valid" CHECK(("media_representations"."state" = 'failed'
                    and "media_representations"."failure_code" is not null
                    and length(trim("media_representations"."failure_code")) > 0
                    and "media_representations"."failure_message" is not null
                    and length(trim("media_representations"."failure_message")) > 0)
                or ("media_representations"."state" <> 'failed'
                    and "media_representations"."failure_code" is null
                    and "media_representations"."failure_message" is null)),
	CONSTRAINT "media_representations_derivation_valid" CHECK(("media_representations"."kind" = 'original'
                    and "media_representations"."source_representation_id" is null
                    and "media_representations"."processor_id" is null
                    and "media_representations"."processor_version" is null
                    and "media_representations"."recipe_json" is null)
                or ("media_representations"."kind" = 'derived'
                    and "media_representations"."source_representation_id" is not null
                    and "media_representations"."processor_id" is not null
                    and length(trim("media_representations"."processor_id")) > 0
                    and "media_representations"."processor_version" is not null
                    and length(trim("media_representations"."processor_version")) > 0
                    and "media_representations"."recipe_json" is not null
                    and json_valid("media_representations"."recipe_json")
                    and json_type("media_representations"."recipe_json") = 'object'))
);

CREATE UNIQUE INDEX "media_representations_project_asset_id_uidx" ON "media_representations" ("project_id","asset_id","id");

CREATE INDEX "media_representations_project_asset_idx" ON "media_representations" ("project_id","asset_id");

CREATE UNIQUE INDEX "media_representations_project_id_id_uidx" ON "media_representations" ("project_id","id");

CREATE UNIQUE INDEX "media_representations_project_original_uidx" ON "media_representations" ("project_id","asset_id") WHERE "media_representations"."kind" = 'original';

CREATE INDEX "media_representations_project_state_idx" ON "media_representations" ("project_id","state");

CREATE UNIQUE INDEX "media_representations_store_object_uidx" ON "media_representations" ("store_id","object_key");

-- postdot:postgres
CREATE TABLE "media_representations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"kind" text NOT NULL,
	"source_representation_id" text,
	"state" text NOT NULL,
	"store_id" text NOT NULL,
	"object_key" text NOT NULL,
	"declared_content_type" text,
	"detected_content_type" text,
	"detected_format" text,
	"family" text,
	"byte_size" bigint,
	"sha256" text,
	"width" bigint,
	"height" bigint,
	"duration_ms" bigint,
	"page_count" bigint,
	"is_animated" bigint,
	"processor_id" text,
	"processor_version" text,
	"recipe_json" text,
	"failure_code" text,
	"failure_message" text,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL, "deletion_restore_state" text, "deletion_restore_failure_code" text, "deletion_restore_failure_message" text,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","asset_id") REFERENCES "media_assets"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "media_representations_kind_valid" CHECK("media_representations"."kind" in ('original', 'derived')),
	CONSTRAINT "media_representations_state_valid" CHECK("media_representations"."state" in ('reserved', 'stored', 'inspecting', 'ready', 'failed', 'deletion_requested', 'deleted')),
	CONSTRAINT "media_representations_store_locator_valid" CHECK(length(trim("media_representations"."store_id")) > 0
                and length(trim("media_representations"."object_key")) > 0
                and length("media_representations"."object_key") <= 1024),
	CONSTRAINT "media_representations_declared_type_valid" CHECK("media_representations"."declared_content_type" is null or length(trim("media_representations"."declared_content_type")) > 0),
	CONSTRAINT "media_representations_dimensions_valid" CHECK(("media_representations"."width" is null or "media_representations"."width" > 0)
                and ("media_representations"."height" is null or "media_representations"."height" > 0)
                and ("media_representations"."duration_ms" is null or "media_representations"."duration_ms" >= 0)
                and ("media_representations"."page_count" is null or "media_representations"."page_count" > 0)),
	CONSTRAINT "media_representations_hash_valid" CHECK("media_representations"."sha256" is null or length("media_representations"."sha256") = 64),
	CONSTRAINT "media_representations_family_valid" CHECK("media_representations"."family" is null or "media_representations"."family" in ('image', 'video', 'audio', 'document')),
	CONSTRAINT "media_representations_ready_facts_valid" CHECK("media_representations"."state" <> 'ready'
                or ("media_representations"."detected_content_type" is not null
                    and "media_representations"."detected_format" is not null
                    and "media_representations"."family" is not null
                    and "media_representations"."byte_size" is not null
                    and "media_representations"."sha256" is not null)),
	CONSTRAINT "media_representations_failure_valid" CHECK(("media_representations"."state" = 'failed'
                    and "media_representations"."failure_code" is not null
                    and length(trim("media_representations"."failure_code")) > 0
                    and "media_representations"."failure_message" is not null
                    and length(trim("media_representations"."failure_message")) > 0)
                or ("media_representations"."state" <> 'failed'
                    and "media_representations"."failure_code" is null
                    and "media_representations"."failure_message" is null)),
	CONSTRAINT "media_representations_derivation_valid" CHECK(("media_representations"."kind" = 'original'
                    and "media_representations"."source_representation_id" is null
                    and "media_representations"."processor_id" is null
                    and "media_representations"."processor_version" is null
                    and "media_representations"."recipe_json" is null)
                or ("media_representations"."kind" = 'derived'
                    and "media_representations"."source_representation_id" is not null
                    and "media_representations"."processor_id" is not null
                    and length(trim("media_representations"."processor_id")) > 0
                    and "media_representations"."processor_version" is not null
                    and length(trim("media_representations"."processor_version")) > 0
                    and "media_representations"."recipe_json" is not null
                    and json_valid("media_representations"."recipe_json")
                    and json_type("media_representations"."recipe_json") = 'object'))
);

CREATE UNIQUE INDEX "media_representations_project_asset_id_uidx" ON "media_representations" ("project_id","asset_id","id");

CREATE INDEX "media_representations_project_asset_idx" ON "media_representations" ("project_id","asset_id");

CREATE UNIQUE INDEX "media_representations_project_id_id_uidx" ON "media_representations" ("project_id","id");

CREATE UNIQUE INDEX "media_representations_project_original_uidx" ON "media_representations" ("project_id","asset_id") WHERE "media_representations"."kind" = 'original';

CREATE INDEX "media_representations_project_state_idx" ON "media_representations" ("project_id","state");

CREATE UNIQUE INDEX "media_representations_store_object_uidx" ON "media_representations" ("store_id","object_key");

ALTER TABLE "media_representations" ADD FOREIGN KEY ("project_id","asset_id","source_representation_id") REFERENCES "media_representations"("project_id","asset_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE;

-- postdot:common
CREATE TABLE "media_upload_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"representation_id" text NOT NULL,
	"state" text NOT NULL,
	"expected_size" bigint,
	"max_bytes" bigint NOT NULL,
	"content_type_hint" text,
	"expires_at" bigint NOT NULL,
	"upload_started_at" bigint,
	"completed_at" bigint,
	"failure_code" text,
	"failure_message" text,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","asset_id") REFERENCES "media_assets"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","asset_id","representation_id") REFERENCES "media_representations"("project_id","asset_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "media_upload_intents_state_valid" CHECK("media_upload_intents"."state" in ('pending', 'uploading', 'uploaded', 'consumed', 'expired', 'failed')),
	CONSTRAINT "media_upload_intents_limits_valid" CHECK("media_upload_intents"."max_bytes" > 0
                and ("media_upload_intents"."expected_size" is null or ("media_upload_intents"."expected_size" >= 0 and "media_upload_intents"."expected_size" <= "media_upload_intents"."max_bytes"))),
	CONSTRAINT "media_upload_intents_content_type_valid" CHECK("media_upload_intents"."content_type_hint" is null or length(trim("media_upload_intents"."content_type_hint")) > 0),
	CONSTRAINT "media_upload_intents_expiry_valid" CHECK("media_upload_intents"."expires_at" > "media_upload_intents"."created_at"),
	CONSTRAINT "media_upload_intents_terminal_state_valid" CHECK(("media_upload_intents"."state" in ('pending', 'uploading', 'uploaded')
                    and "media_upload_intents"."completed_at" is null
                    and "media_upload_intents"."failure_code" is null
                    and "media_upload_intents"."failure_message" is null)
                or ("media_upload_intents"."state" in ('consumed', 'expired')
                    and "media_upload_intents"."completed_at" is not null
                    and "media_upload_intents"."failure_code" is null
                    and "media_upload_intents"."failure_message" is null)
                or ("media_upload_intents"."state" = 'failed'
                    and "media_upload_intents"."completed_at" is not null
                    and "media_upload_intents"."failure_code" is not null
                    and length(trim("media_upload_intents"."failure_code")) > 0
                    and "media_upload_intents"."failure_message" is not null
                    and length(trim("media_upload_intents"."failure_message")) > 0)),
	CONSTRAINT "media_upload_intents_upload_start_valid" CHECK("media_upload_intents"."upload_started_at" is null or "media_upload_intents"."upload_started_at" >= "media_upload_intents"."created_at"),
	CONSTRAINT "media_upload_intents_upload_start_state_valid" CHECK(("media_upload_intents"."state" = 'pending' and "media_upload_intents"."upload_started_at" is null)
                or ("media_upload_intents"."state" in ('uploading', 'uploaded', 'consumed')
                    and "media_upload_intents"."upload_started_at" is not null)
                or ("media_upload_intents"."state" in ('expired', 'failed')))
);

CREATE UNIQUE INDEX "media_upload_intents_project_representation_uidx" ON "media_upload_intents" ("project_id","representation_id");

CREATE INDEX "media_upload_intents_state_expires_idx" ON "media_upload_intents" ("state","expires_at");

CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX "member_organization_id_idx" ON "member" ("organization_id");

CREATE UNIQUE INDEX "member_organization_user_uidx" ON "member" ("organization_id","user_id");

CREATE INDEX "member_user_id_idx" ON "member" ("user_id");

CREATE TABLE "notification_destinations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"recipient_actor_id" text NOT NULL,
	"transport_id" text NOT NULL,
	"label" text NOT NULL,
	"configuration_json" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","recipient_actor_id") REFERENCES "actors"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "notification_destinations_transport_nonblank" CHECK(length(trim("notification_destinations"."transport_id")) > 0),
	CONSTRAINT "notification_destinations_label_nonblank" CHECK(length(trim("notification_destinations"."label")) > 0),
	CONSTRAINT "notification_destinations_configuration_object" CHECK(json_valid("notification_destinations"."configuration_json") and json_type("notification_destinations"."configuration_json") = 'object'),
	CONSTRAINT "notification_destinations_state_valid" CHECK("notification_destinations"."state" in ('active', 'disabled'))
);

CREATE INDEX "notification_destinations_project_actor_state_idx" ON "notification_destinations" ("project_id","recipient_actor_id","state");

CREATE UNIQUE INDEX "notification_destinations_project_id_id_uidx" ON "notification_destinations" ("project_id","id");

CREATE TABLE "notification_destination_secrets" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"destination_id" text NOT NULL,
	"version" bigint NOT NULL,
	"transport_id" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"encryption_version" bigint NOT NULL,
	"encryption_key_id" text NOT NULL,
	"ciphertext" blob NOT NULL,
	"nonce" blob NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","destination_id") REFERENCES "notification_destinations"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "notification_destination_secrets_version_valid" CHECK("notification_destination_secrets"."version" > 0),
	CONSTRAINT "notification_destination_secrets_transport_nonblank" CHECK(length(trim("notification_destination_secrets"."transport_id")) > 0),
	CONSTRAINT "notification_destination_secrets_state_valid" CHECK("notification_destination_secrets"."state" in ('active', 'retired')),
	CONSTRAINT "notification_destination_secrets_encryption_version_valid" CHECK("notification_destination_secrets"."encryption_version" > 0),
	CONSTRAINT "notification_destination_secrets_encryption_key_nonblank" CHECK(length(trim("notification_destination_secrets"."encryption_key_id")) > 0),
	CONSTRAINT "notification_destination_secrets_ciphertext_valid" CHECK(length("notification_destination_secrets"."ciphertext") > 16),
	CONSTRAINT "notification_destination_secrets_nonce_valid" CHECK(length("notification_destination_secrets"."nonce") = 12)
);

CREATE UNIQUE INDEX "notification_destination_secrets_project_destination_active_uidx" ON "notification_destination_secrets" ("project_id","destination_id") WHERE "notification_destination_secrets"."state" = 'active';

CREATE UNIQUE INDEX "notification_destination_secrets_project_destination_id_uidx" ON "notification_destination_secrets" ("project_id","destination_id","id");

CREATE UNIQUE INDEX "notification_destination_secrets_project_destination_version_uidx" ON "notification_destination_secrets" ("project_id","destination_id","version");

CREATE UNIQUE INDEX "notification_destination_secrets_project_id_id_uidx" ON "notification_destination_secrets" ("project_id","id");

CREATE TABLE "notification_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"destination_id" text NOT NULL,
	"secret_id" text,
	"source_event_id" text NOT NULL,
	"transport_id" text NOT NULL,
	"configuration_json" text NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempt_count" bigint DEFAULT 0 NOT NULL,
	"next_attempt_at" bigint NOT NULL,
	"lease_token" text,
	"lease_expires_at" bigint,
	"effect_started_at" bigint,
	"delivered_at" bigint,
	"failed_at" bigint,
	"ambiguous_at" bigint,
	"external_id" text,
	"last_error" text,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","destination_id") REFERENCES "notification_destinations"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","destination_id","secret_id") REFERENCES "notification_destination_secrets"("project_id","destination_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","source_event_id") REFERENCES "audit_events"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "notification_deliveries_transport_nonblank" CHECK(length(trim("notification_deliveries"."transport_id")) > 0),
	CONSTRAINT "notification_deliveries_configuration_object" CHECK(json_valid("notification_deliveries"."configuration_json") and json_type("notification_deliveries"."configuration_json") = 'object'),
	CONSTRAINT "notification_deliveries_kind_valid" CHECK("notification_deliveries"."kind" in ('publication_published', 'publication_failed', 'publication_ambiguous')),
	CONSTRAINT "notification_deliveries_severity_valid" CHECK("notification_deliveries"."severity" in ('success', 'warning', 'error')),
	CONSTRAINT "notification_deliveries_subject_type_nonblank" CHECK(length(trim("notification_deliveries"."subject_type")) > 0),
	CONSTRAINT "notification_deliveries_subject_id_nonblank" CHECK(length(trim("notification_deliveries"."subject_id")) > 0),
	CONSTRAINT "notification_deliveries_title_nonblank" CHECK(length(trim("notification_deliveries"."title")) > 0),
	CONSTRAINT "notification_deliveries_body_nonblank" CHECK(length(trim("notification_deliveries"."body")) > 0),
	CONSTRAINT "notification_deliveries_state_valid" CHECK("notification_deliveries"."state" in ('pending', 'running', 'delivered', 'failed', 'ambiguous')),
	CONSTRAINT "notification_deliveries_attempt_count_valid" CHECK("notification_deliveries"."attempt_count" >= 0),
	CONSTRAINT "notification_deliveries_next_attempt_valid" CHECK("notification_deliveries"."next_attempt_at" >= "notification_deliveries"."created_at"),
	CONSTRAINT "notification_deliveries_lease_valid" CHECK((
            ("notification_deliveries"."lease_token" is null and "notification_deliveries"."lease_expires_at" is null)
            or ("notification_deliveries"."lease_token" is not null and "notification_deliveries"."lease_expires_at" is not null and "notification_deliveries"."lease_expires_at" >= "notification_deliveries"."created_at")
        )),
	CONSTRAINT "notification_deliveries_terminal_time_valid" CHECK((
            ("notification_deliveries"."delivered_at" is null or "notification_deliveries"."delivered_at" >= "notification_deliveries"."created_at")
            and ("notification_deliveries"."failed_at" is null or "notification_deliveries"."failed_at" >= "notification_deliveries"."created_at")
            and ("notification_deliveries"."ambiguous_at" is null or "notification_deliveries"."ambiguous_at" >= "notification_deliveries"."created_at")
        ))
);

CREATE INDEX "notification_deliveries_project_destination_idx" ON "notification_deliveries" ("project_id","destination_id","created_at");

CREATE UNIQUE INDEX "notification_deliveries_project_destination_source_uidx" ON "notification_deliveries" ("project_id","destination_id","source_event_id");

CREATE INDEX "notification_deliveries_project_due_idx" ON "notification_deliveries" ("project_id","state","next_attempt_at");

CREATE TABLE "notification_delivery_projection_cursors" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"projection" text NOT NULL,
	"cursor" text,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "notification_delivery_cursors_projection_nonblank" CHECK(length(trim("notification_delivery_projection_cursors"."projection")) > 0),
	CONSTRAINT "notification_delivery_cursors_cursor_nonblank" CHECK("notification_delivery_projection_cursors"."cursor" is null or length(trim("notification_delivery_projection_cursors"."cursor")) > 0)
);

CREATE UNIQUE INDEX "notification_delivery_cursors_project_projection_uidx" ON "notification_delivery_projection_cursors" ("project_id","projection");

CREATE TABLE "notification_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"recipient_actor_id" text NOT NULL,
	"kind" text NOT NULL,
	"in_app_enabled" bigint DEFAULT 1 NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","recipient_actor_id") REFERENCES "actors"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "notification_preferences_kind_valid" CHECK("notification_preferences"."kind" in ('publication_published', 'publication_failed', 'publication_ambiguous'))
);

CREATE UNIQUE INDEX "notification_preferences_recipient_kind_uidx" ON "notification_preferences" ("project_id","recipient_actor_id","kind");

CREATE TABLE "notification_projection_cursors" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"projection" text NOT NULL,
	"cursor" text,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "notification_projection_cursors_projection_nonblank" CHECK(length(trim("notification_projection_cursors"."projection")) > 0),
	CONSTRAINT "notification_projection_cursors_cursor_nonblank" CHECK("notification_projection_cursors"."cursor" is null or length(trim("notification_projection_cursors"."cursor")) > 0)
);

CREATE UNIQUE INDEX "notification_projection_cursors_project_projection_uidx" ON "notification_projection_cursors" ("project_id","projection");

CREATE TABLE "notification_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"destination_id" text NOT NULL,
	"kind" text NOT NULL,
	"enabled" bigint DEFAULT 1 NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","destination_id") REFERENCES "notification_destinations"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "notification_subscriptions_kind_valid" CHECK("notification_subscriptions"."kind" in ('publication_published', 'publication_failed', 'publication_ambiguous'))
);

CREATE UNIQUE INDEX "notification_subscriptions_project_destination_kind_uidx" ON "notification_subscriptions" ("project_id","destination_id","kind");

CREATE TABLE "notification_user_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"in_app_enabled" bigint DEFAULT 1 NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	CONSTRAINT "notification_user_preferences_user_nonblank" CHECK(length(trim("notification_user_preferences"."user_id")) > 0),
	CONSTRAINT "notification_user_preferences_kind_valid" CHECK("notification_user_preferences"."kind" in ('publication_published', 'publication_failed', 'publication_ambiguous'))
);

CREATE UNIQUE INDEX "notification_user_preferences_user_kind_uidx" ON "notification_user_preferences" ("user_id","kind");

CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"recipient_user_id" text NOT NULL,
	"recipient_actor_id" text,
	"source_event_id" text NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"read_at" bigint,
	"archived_at" bigint,
	"created_at" bigint NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","recipient_actor_id") REFERENCES "actors"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","source_event_id") REFERENCES "audit_events"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "notifications_kind_valid" CHECK("notifications"."kind" in ('publication_published', 'publication_failed', 'publication_ambiguous')),
	CONSTRAINT "notifications_severity_valid" CHECK("notifications"."severity" in ('success', 'warning', 'error')),
	CONSTRAINT "notifications_project_actor_scope_valid" CHECK(("notifications"."project_id" is null and "notifications"."recipient_actor_id" is null)
                or ("notifications"."project_id" is not null and "notifications"."recipient_actor_id" is not null)),
	CONSTRAINT "notifications_recipient_user_nonblank" CHECK(length(trim("notifications"."recipient_user_id")) > 0),
	CONSTRAINT "notifications_subject_type_nonblank" CHECK(length(trim("notifications"."subject_type")) > 0),
	CONSTRAINT "notifications_subject_id_nonblank" CHECK(length(trim("notifications"."subject_id")) > 0),
	CONSTRAINT "notifications_title_nonblank" CHECK(length(trim("notifications"."title")) > 0),
	CONSTRAINT "notifications_body_nonblank" CHECK(length(trim("notifications"."body")) > 0),
	CONSTRAINT "notifications_read_at_valid" CHECK("notifications"."read_at" is null or "notifications"."read_at" >= "notifications"."created_at"),
	CONSTRAINT "notifications_archived_at_valid" CHECK("notifications"."archived_at" is null or "notifications"."archived_at" >= "notifications"."created_at")
);

CREATE INDEX "notifications_user_inbox_idx" ON "notifications" ("recipient_user_id","project_id","archived_at","created_at");

CREATE UNIQUE INDEX "notifications_user_project_source_event_uidx" ON "notifications" ("recipient_user_id","project_id","source_event_id");

CREATE INDEX "notifications_user_unread_idx" ON "notifications" ("recipient_user_id","project_id","read_at","archived_at");

CREATE TABLE "provider_application_configurations" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"name" text NOT NULL,
	"client_id" text,
	"client_metadata_url" text,
	"handle_resolver" text,
	"state" text DEFAULT 'active' NOT NULL,
	"is_default" bigint DEFAULT 0 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"encryption_version" bigint,
	"encryption_key_id" text,
	"client_secret_ciphertext" blob,
	"client_secret_nonce" blob,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "provider_application_configurations_provider_valid" CHECK("provider_application_configurations"."provider_id" in ('linkedin', 'bluesky', 'x', 'facebook', 'instagram')),
	CONSTRAINT "provider_application_configurations_name_nonblank" CHECK(length(trim("provider_application_configurations"."name")) > 0),
	CONSTRAINT "provider_application_configurations_state_valid" CHECK("provider_application_configurations"."state" in ('active', 'disabled')),
	CONSTRAINT "provider_application_configurations_shape_valid" CHECK((
                "provider_application_configurations"."provider_id" in ('linkedin', 'x', 'facebook', 'instagram')
                and "provider_application_configurations"."client_id" is not null
                and length(trim("provider_application_configurations"."client_id")) > 0
                and "provider_application_configurations"."client_metadata_url" is null
                and "provider_application_configurations"."handle_resolver" is null
                and "provider_application_configurations"."encryption_version" is not null
                and "provider_application_configurations"."encryption_key_id" is not null
                and "provider_application_configurations"."client_secret_ciphertext" is not null
                and "provider_application_configurations"."client_secret_nonce" is not null
            ) or (
                "provider_application_configurations"."provider_id" = 'bluesky'
                and "provider_application_configurations"."client_id" is null
                and ("provider_application_configurations"."client_metadata_url" is null or length(trim("provider_application_configurations"."client_metadata_url")) > 0)
                and "provider_application_configurations"."handle_resolver" is not null
                and length(trim("provider_application_configurations"."handle_resolver")) > 0
                and "provider_application_configurations"."encryption_version" is null
                and "provider_application_configurations"."encryption_key_id" is null
                and "provider_application_configurations"."client_secret_ciphertext" is null
                and "provider_application_configurations"."client_secret_nonce" is null
            )),
	CONSTRAINT "provider_application_configurations_encryption_version_valid" CHECK(("provider_application_configurations"."encryption_version" is null and "provider_application_configurations"."encryption_key_id" is null)
                or ("provider_application_configurations"."encryption_version" > 0 and "provider_application_configurations"."encryption_key_id" is not null
                    and length(trim("provider_application_configurations"."encryption_key_id")) > 0)),
	CONSTRAINT "provider_application_configurations_secret_envelope_valid" CHECK(("provider_application_configurations"."client_secret_ciphertext" is null and "provider_application_configurations"."client_secret_nonce" is null)
                or ("provider_application_configurations"."client_secret_ciphertext" is not null
                    and length("provider_application_configurations"."client_secret_ciphertext") > 16
                    and "provider_application_configurations"."client_secret_nonce" is not null
                    and length("provider_application_configurations"."client_secret_nonce") = 12))
);

CREATE UNIQUE INDEX "provider_application_configurations_provider_default_uidx" ON "provider_application_configurations" ("provider_id") WHERE "provider_application_configurations"."is_default" = 1;

CREATE UNIQUE INDEX "provider_application_configurations_provider_id_id_uidx" ON "provider_application_configurations" ("provider_id","id");

CREATE INDEX "provider_application_configurations_provider_state_idx" ON "provider_application_configurations" ("provider_id","state");

CREATE TABLE "oauth_authorization_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"connected_by_actor_id" text NOT NULL,
	"provider_application_id" text,
	"callback_uri" text NOT NULL,
	"scopes" text NOT NULL,
	"return_path" text NOT NULL,
	"context_json" text DEFAULT '{}' NOT NULL,
	"state_digest" blob NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"pkce_encryption_version" bigint,
	"pkce_encryption_key_id" text,
	"pkce_verifier_ciphertext" blob,
	"pkce_verifier_nonce" blob,
	"provider_state_encryption_version" bigint,
	"provider_state_encryption_key_id" text,
	"provider_state_ciphertext" blob,
	"provider_state_nonce" blob,
	"expires_at" bigint NOT NULL,
	"completed_at" bigint,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","channel_id") REFERENCES project_channel_attachments(project_id,channel_id) ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","connected_by_actor_id") REFERENCES "actors"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("provider_id","provider_application_id") REFERENCES "provider_application_configurations"("provider_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "oauth_authorization_attempts_provider_nonblank" CHECK(length(trim("oauth_authorization_attempts"."provider_id")) > 0),
	CONSTRAINT "oauth_authorization_attempts_callback_nonblank" CHECK(length(trim("oauth_authorization_attempts"."callback_uri")) > 0),
	CONSTRAINT "oauth_authorization_attempts_return_path_local" CHECK(substr("oauth_authorization_attempts"."return_path", 1, 1) = '/'
                and substr("oauth_authorization_attempts"."return_path", 1, 2) != '//'
                and instr("oauth_authorization_attempts"."return_path", '\') = 0),
	CONSTRAINT "oauth_authorization_attempts_scopes_json_array" CHECK(json_valid("oauth_authorization_attempts"."scopes") and json_type("oauth_authorization_attempts"."scopes") = 'array'),
	CONSTRAINT "oauth_authorization_attempts_context_json_object" CHECK(json_valid("oauth_authorization_attempts"."context_json") and json_type("oauth_authorization_attempts"."context_json") = 'object'),
	CONSTRAINT "oauth_authorization_attempts_state_digest_length" CHECK(length("oauth_authorization_attempts"."state_digest") = 32),
	CONSTRAINT "oauth_authorization_attempts_status_valid" CHECK("oauth_authorization_attempts"."status" in ('pending', 'consumed', 'expired')),
	CONSTRAINT "oauth_authorization_attempts_time_valid" CHECK("oauth_authorization_attempts"."expires_at" > "oauth_authorization_attempts"."created_at"
                and ("oauth_authorization_attempts"."completed_at" is null or "oauth_authorization_attempts"."completed_at" >= "oauth_authorization_attempts"."created_at")),
	CONSTRAINT "oauth_authorization_attempts_secret_state_valid" CHECK((
                    "oauth_authorization_attempts"."status" = 'pending'
                    and "oauth_authorization_attempts"."completed_at" is null
                    and (
                        (
                            "oauth_authorization_attempts"."pkce_encryption_version" is null
                            and "oauth_authorization_attempts"."pkce_encryption_key_id" is null
                            and "oauth_authorization_attempts"."pkce_verifier_ciphertext" is null
                            and "oauth_authorization_attempts"."pkce_verifier_nonce" is null
                        ) or (
                            "oauth_authorization_attempts"."pkce_encryption_version" is not null
                            and "oauth_authorization_attempts"."pkce_encryption_version" > 0
                            and "oauth_authorization_attempts"."pkce_encryption_key_id" is not null
                            and length(trim("oauth_authorization_attempts"."pkce_encryption_key_id")) > 0
                            and "oauth_authorization_attempts"."pkce_verifier_ciphertext" is not null
                            and length("oauth_authorization_attempts"."pkce_verifier_ciphertext") > 16
                            and "oauth_authorization_attempts"."pkce_verifier_nonce" is not null
                            and length("oauth_authorization_attempts"."pkce_verifier_nonce") = 12
                        )
                    )
                    and (
                        (
                            "oauth_authorization_attempts"."provider_state_encryption_version" is null
                            and "oauth_authorization_attempts"."provider_state_encryption_key_id" is null
                            and "oauth_authorization_attempts"."provider_state_ciphertext" is null
                            and "oauth_authorization_attempts"."provider_state_nonce" is null
                        ) or (
                            "oauth_authorization_attempts"."provider_state_encryption_version" is not null
                            and "oauth_authorization_attempts"."provider_state_encryption_version" > 0
                            and "oauth_authorization_attempts"."provider_state_encryption_key_id" is not null
                            and length(trim("oauth_authorization_attempts"."provider_state_encryption_key_id")) > 0
                            and "oauth_authorization_attempts"."provider_state_ciphertext" is not null
                            and length("oauth_authorization_attempts"."provider_state_ciphertext") > 16
                            and "oauth_authorization_attempts"."provider_state_nonce" is not null
                            and length("oauth_authorization_attempts"."provider_state_nonce") = 12
                        )
                    )
                ) or (
                    "oauth_authorization_attempts"."status" in ('consumed', 'expired')
                    and "oauth_authorization_attempts"."completed_at" is not null
                    and "oauth_authorization_attempts"."pkce_encryption_version" is null
                    and "oauth_authorization_attempts"."pkce_encryption_key_id" is null
                    and "oauth_authorization_attempts"."pkce_verifier_ciphertext" is null
                    and "oauth_authorization_attempts"."pkce_verifier_nonce" is null
                    and "oauth_authorization_attempts"."provider_state_encryption_version" is null
                    and "oauth_authorization_attempts"."provider_state_encryption_key_id" is null
                    and "oauth_authorization_attempts"."provider_state_ciphertext" is null
                    and "oauth_authorization_attempts"."provider_state_nonce" is null
                ))
);

CREATE INDEX "oauth_authorization_attempts_project_channel_idx" ON "oauth_authorization_attempts" ("project_id","channel_id");

CREATE UNIQUE INDEX "oauth_authorization_attempts_state_digest_uidx" ON "oauth_authorization_attempts" ("state_digest");

CREATE INDEX "oauth_authorization_attempts_status_expires_idx" ON "oauth_authorization_attempts" ("status","expires_at");

CREATE TABLE "publishers" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("workspace_id","channel_id") REFERENCES "channels"("workspace_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "publishers_kind_nonblank" CHECK(length(trim("publishers"."kind")) > 0)
);

CREATE UNIQUE INDEX publishers_channel_id_id_uidx ON publishers(channel_id,id);

CREATE UNIQUE INDEX "publishers_workspace_id_channel_id_uidx" ON "publishers" ("workspace_id","channel_id");

CREATE UNIQUE INDEX "publishers_workspace_id_id_uidx" ON "publishers" ("workspace_id","id");

CREATE TABLE project_channel_publishers (project_id text NOT NULL, channel_id text NOT NULL, publisher_id text NOT NULL,
 PRIMARY KEY(project_id,publisher_id),
 FOREIGN KEY(project_id,channel_id) REFERENCES project_channel_attachments(project_id,channel_id) ON DELETE CASCADE,
 FOREIGN KEY(channel_id,publisher_id) REFERENCES publishers(channel_id,id) ON DELETE CASCADE);

CREATE TABLE "project_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"archived_at" bigint,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "project_tags_name_nonblank" CHECK(length(trim("project_tags"."name")) > 0),
	CONSTRAINT "project_tags_normalized_name_nonblank" CHECK(length(trim("project_tags"."normalized_name")) > 0),
	CONSTRAINT "project_tags_name_length_valid" CHECK(length("project_tags"."name") <= 120 and length("project_tags"."normalized_name") <= 120),
	CONSTRAINT "project_tags_state_valid" CHECK("project_tags"."state" in ('active', 'archived')),
	CONSTRAINT "project_tags_archived_timestamp_valid" CHECK(("project_tags"."state" = 'active' and "project_tags"."archived_at" is null)
                or ("project_tags"."state" = 'archived' and "project_tags"."archived_at" is not null))
);

CREATE UNIQUE INDEX "project_tags_project_id_id_uidx" ON "project_tags" ("project_id","id");

CREATE UNIQUE INDEX "project_tags_project_id_normalized_name_uidx" ON "project_tags" ("project_id","normalized_name");

CREATE TABLE "team" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"member_count" bigint DEFAULT 0 NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX "team_organization_id_idx" ON "team" ("organization_id");

CREATE TABLE "project_team_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"team_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("team_id") REFERENCES "team"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "project_team_grants_role_valid" CHECK("project_team_grants"."role" in ('owner', 'editor', 'viewer'))
);

CREATE UNIQUE INDEX "project_team_grants_project_team_uidx" ON "project_team_grants" ("project_id","team_id");

CREATE INDEX "project_team_grants_team_project_idx" ON "project_team_grants" ("team_id","project_id");

CREATE TABLE "project_user_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "project_user_grants_role_valid" CHECK("project_user_grants"."role" in ('owner', 'editor', 'viewer'))
);

CREATE UNIQUE INDEX "project_user_grants_project_user_uidx" ON "project_user_grants" ("project_id","user_id");

CREATE INDEX "project_user_grants_user_project_idx" ON "project_user_grants" ("user_id","project_id");

CREATE TABLE "provider_analytics_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"provider" text NOT NULL,
	"subject_type" text NOT NULL,
	"provider_subject_id" text NOT NULL,
	"provider_subject_label" text,
	"provider_content_revision_id" text,
	"postdot_entity_type" text,
	"postdot_entity_id" text,
	"metric_name" text NOT NULL,
	"value" double precision,
	"unit" text NOT NULL,
	"aggregation" text NOT NULL,
	"reporting_period_start" bigint,
	"reporting_period_end" bigint,
	"observed_at" bigint,
	"fetched_at" bigint NOT NULL,
	"availability" text NOT NULL,
	"freshness" text NOT NULL,
	"provenance" text NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "provider_analytics_observations_provider_nonblank" CHECK(length(trim("provider_analytics_observations"."provider")) > 0),
	CONSTRAINT "provider_analytics_observations_subject_id_nonblank" CHECK(length(trim("provider_analytics_observations"."provider_subject_id")) > 0),
	CONSTRAINT "provider_analytics_observations_subject_label_nonblank" CHECK("provider_analytics_observations"."provider_subject_label" is null or length(trim("provider_analytics_observations"."provider_subject_label")) > 0),
	CONSTRAINT "provider_analytics_observations_content_revision_nonblank" CHECK("provider_analytics_observations"."provider_content_revision_id" is null or length(trim("provider_analytics_observations"."provider_content_revision_id")) > 0),
	CONSTRAINT "provider_analytics_observations_entity_pair_valid" CHECK(("provider_analytics_observations"."postdot_entity_type" is null and "provider_analytics_observations"."postdot_entity_id" is null)
                or ("provider_analytics_observations"."postdot_entity_type" is not null
                    and "provider_analytics_observations"."postdot_entity_id" is not null
                    and length(trim("provider_analytics_observations"."postdot_entity_id")) > 0)),
	CONSTRAINT "provider_analytics_observations_metric_nonblank" CHECK(length(trim("provider_analytics_observations"."metric_name")) > 0),
	CONSTRAINT "provider_analytics_observations_unit_nonblank" CHECK(length(trim("provider_analytics_observations"."unit")) > 0),
	CONSTRAINT "provider_analytics_observations_aggregation_nonblank" CHECK(length(trim("provider_analytics_observations"."aggregation")) > 0),
	CONSTRAINT "provider_analytics_observations_provenance_nonblank" CHECK(length(trim("provider_analytics_observations"."provenance")) > 0),
	CONSTRAINT "provider_analytics_observations_value_valid" CHECK("provider_analytics_observations"."value" is null or ("provider_analytics_observations"."value" >= 0 and "provider_analytics_observations"."value" = "provider_analytics_observations"."value")),
	CONSTRAINT "provider_analytics_observations_availability_value_valid" CHECK(("provider_analytics_observations"."availability" = 'measured' and "provider_analytics_observations"."value" is not null)
                or ("provider_analytics_observations"."availability" <> 'measured' and "provider_analytics_observations"."value" is null)),
	CONSTRAINT "provider_analytics_observations_period_valid" CHECK(("provider_analytics_observations"."reporting_period_start" is null and "provider_analytics_observations"."reporting_period_end" is null)
                or ("provider_analytics_observations"."reporting_period_start" is not null
                    and "provider_analytics_observations"."reporting_period_end" is not null
                    and "provider_analytics_observations"."reporting_period_start" >= 0
                    and "provider_analytics_observations"."reporting_period_end" > "provider_analytics_observations"."reporting_period_start")),
	CONSTRAINT "provider_analytics_observations_timestamps_valid" CHECK(("provider_analytics_observations"."observed_at" is null or "provider_analytics_observations"."observed_at" >= 0)
                and "provider_analytics_observations"."fetched_at" >= 0),
	CONSTRAINT "provider_analytics_observations_enum_valid" CHECK("provider_analytics_observations"."subject_type" in ('account', 'content')
                and ("provider_analytics_observations"."postdot_entity_type" is null or "provider_analytics_observations"."postdot_entity_type" in ('channel', 'publication'))
                and "provider_analytics_observations"."availability" in ('measured', 'not_reported', 'not_found', 'blocked', 'disabled', 'temporarily_unavailable', 'rate_limited', 'invalid_response', 'partial_response', 'not_configured', 'not_authorized', 'not_supported')
                and "provider_analytics_observations"."freshness" in ('fresh', 'stale', 'unknown'))
);

CREATE INDEX "provider_analytics_observations_project_entity_idx" ON "provider_analytics_observations" ("project_id","postdot_entity_type","postdot_entity_id","fetched_at");

CREATE UNIQUE INDEX "provider_analytics_observations_project_id_id_uidx" ON "provider_analytics_observations" ("project_id","id");

CREATE INDEX "provider_analytics_observations_project_subject_idx" ON "provider_analytics_observations" ("project_id","provider","subject_type","provider_subject_id","fetched_at");

CREATE UNIQUE INDEX "provider_analytics_observations_snapshot_uidx" ON "provider_analytics_observations" ("project_id","provider","subject_type","provider_subject_id","metric_name","fetched_at");

CREATE TABLE "publication_target_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"publication_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"profile_version_id" text NOT NULL,
	"source_revision" bigint NOT NULL,
	"delivery_mode" text NOT NULL,
	"media_reference_count" bigint DEFAULT 0 NOT NULL,
	"content_json" text NOT NULL,
	"content_hash" text NOT NULL,
	"profile_hash" text NOT NULL,
	"schema_hash" text NOT NULL,
	"validation_issues_json" text NOT NULL,
	"created_by_actor_id" text NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","publication_id") REFERENCES "publications"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","profile_version_id") REFERENCES project_channel_profiles(project_id,profile_id) ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","created_by_actor_id") REFERENCES "actors"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "publication_target_revisions_sequence_positive" CHECK("publication_target_revisions"."sequence" > 0),
	CONSTRAINT "publication_target_revisions_source_revision_positive" CHECK("publication_target_revisions"."source_revision" > 0),
	CONSTRAINT "publication_target_revisions_content_object" CHECK(json_valid("publication_target_revisions"."content_json") and json_type("publication_target_revisions"."content_json") = 'object'),
	CONSTRAINT "publication_target_revisions_validation_issues_array" CHECK(json_valid("publication_target_revisions"."validation_issues_json") and json_type("publication_target_revisions"."validation_issues_json") = 'array'),
	CONSTRAINT "publication_target_revisions_hashes_nonblank" CHECK(length(trim("publication_target_revisions"."content_hash")) > 0 and length(trim("publication_target_revisions"."profile_hash")) > 0 and length(trim("publication_target_revisions"."schema_hash")) > 0),
	CONSTRAINT "publication_target_revisions_delivery_mode_valid" CHECK("publication_target_revisions"."delivery_mode" in ('manual', 'automatic')),
	CONSTRAINT "publication_target_revisions_media_reference_count_valid" CHECK("publication_target_revisions"."media_reference_count" >= 0)
);

CREATE UNIQUE INDEX "publication_target_revisions_project_id_id_uidx" ON "publication_target_revisions" ("project_id","id");

CREATE INDEX "publication_target_revisions_project_publication_idx" ON "publication_target_revisions" ("project_id","publication_id");

CREATE UNIQUE INDEX "publication_target_revisions_project_publication_sequence_uidx" ON "publication_target_revisions" ("project_id","publication_id","sequence");

CREATE TABLE "publication_execution_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"job_id" text NOT NULL,
	"publication_id" text NOT NULL,
	"target_revision_id" text NOT NULL,
	"profile_version_id" text NOT NULL,
	"delivery_mode" text NOT NULL,
	"media_reference_count" bigint DEFAULT 0 NOT NULL,
	"content_json" text NOT NULL,
	"content_hash" text NOT NULL,
	"profile_hash" text NOT NULL,
	"schema_hash" text NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL, "destination_snapshot_json" text,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","job_id") REFERENCES "jobs"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","publication_id") REFERENCES "publications"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","target_revision_id") REFERENCES "publication_target_revisions"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","profile_version_id") REFERENCES project_channel_profiles(project_id,profile_id) ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "publication_execution_revisions_delivery_mode_automatic" CHECK("publication_execution_revisions"."delivery_mode" = 'automatic'),
	CONSTRAINT "publication_execution_revisions_content_object" CHECK(json_valid("publication_execution_revisions"."content_json") and json_type("publication_execution_revisions"."content_json") = 'object'),
	CONSTRAINT "publication_execution_revisions_hashes_nonblank" CHECK(length(trim("publication_execution_revisions"."content_hash")) > 0 and length(trim("publication_execution_revisions"."profile_hash")) > 0 and length(trim("publication_execution_revisions"."schema_hash")) > 0),
	CONSTRAINT "publication_execution_revisions_media_reference_count_valid" CHECK("publication_execution_revisions"."media_reference_count" >= 0)
);

CREATE UNIQUE INDEX "publication_execution_revisions_project_id_id_uidx" ON "publication_execution_revisions" ("project_id","id");

CREATE UNIQUE INDEX "publication_execution_revisions_project_job_uidx" ON "publication_execution_revisions" ("project_id","job_id");

CREATE TABLE "publication_revision_media" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"target_revision_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"representation_id" text NOT NULL,
	"position" bigint NOT NULL,
	"content_path" text NOT NULL,
	"role" text,
	"accessibility_text" text,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","target_revision_id") REFERENCES "publication_target_revisions"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","asset_id") REFERENCES "media_assets"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","asset_id","representation_id") REFERENCES "media_representations"("project_id","asset_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "publication_revision_media_position_nonnegative" CHECK("publication_revision_media"."position" >= 0),
	CONSTRAINT "publication_revision_media_content_path_valid" CHECK(length("publication_revision_media"."content_path") > 1 and substr("publication_revision_media"."content_path", 1, 1) = '/'),
	CONSTRAINT "publication_revision_media_role_valid" CHECK("publication_revision_media"."role" is null or length(trim("publication_revision_media"."role")) > 0),
	CONSTRAINT "publication_revision_media_accessibility_text_valid" CHECK("publication_revision_media"."accessibility_text" is null or length(trim("publication_revision_media"."accessibility_text")) > 0)
);

CREATE INDEX "publication_revision_media_project_asset_idx" ON "publication_revision_media" ("project_id","asset_id");

CREATE UNIQUE INDEX "publication_revision_media_project_id_id_uidx" ON "publication_revision_media" ("project_id","id");

CREATE UNIQUE INDEX "publication_revision_media_project_revision_position_uidx" ON "publication_revision_media" ("project_id","target_revision_id","position");

CREATE TABLE "publication_execution_revision_media" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"execution_revision_id" text NOT NULL,
	"target_revision_media_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"representation_id" text NOT NULL,
	"position" bigint NOT NULL,
	"content_path" text NOT NULL,
	"role" text,
	"accessibility_text" text,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","execution_revision_id") REFERENCES "publication_execution_revisions"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","target_revision_media_id") REFERENCES "publication_revision_media"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","asset_id") REFERENCES "media_assets"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","asset_id","representation_id") REFERENCES "media_representations"("project_id","asset_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "publication_execution_revision_media_position_nonnegative" CHECK("publication_execution_revision_media"."position" >= 0),
	CONSTRAINT "publication_execution_revision_media_content_path_valid" CHECK(length("publication_execution_revision_media"."content_path") > 1 and substr("publication_execution_revision_media"."content_path", 1, 1) = '/'),
	CONSTRAINT "publication_execution_revision_media_role_valid" CHECK("publication_execution_revision_media"."role" is null or length(trim("publication_execution_revision_media"."role")) > 0),
	CONSTRAINT "publication_execution_revision_media_accessibility_text_valid" CHECK("publication_execution_revision_media"."accessibility_text" is null or length(trim("publication_execution_revision_media"."accessibility_text")) > 0)
);

CREATE INDEX "publication_execution_revision_media_project_asset_idx" ON "publication_execution_revision_media" ("project_id","asset_id");

CREATE UNIQUE INDEX "publication_execution_revision_media_project_id_id_uidx" ON "publication_execution_revision_media" ("project_id","id");

CREATE UNIQUE INDEX "publication_execution_revision_media_revision_position_uidx" ON "publication_execution_revision_media" ("project_id","execution_revision_id","position");

CREATE UNIQUE INDEX "publication_execution_revision_media_revision_target_uidx" ON "publication_execution_revision_media" ("project_id","execution_revision_id","target_revision_media_id");

CREATE TABLE "provider_media_deliveries" (
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
	CONSTRAINT "provider_media_deliveries_provider_nonblank" CHECK(length(trim("provider_media_deliveries"."provider_id")) > 0),
	CONSTRAINT "provider_media_deliveries_attempts_nonnegative" CHECK("provider_media_deliveries"."attempts" >= 0),
	CONSTRAINT "provider_media_deliveries_state_valid" CHECK("provider_media_deliveries"."state" in ('pending', 'uploading', 'uploaded', 'failed', 'ambiguous')),
	CONSTRAINT "provider_media_deliveries_timestamps_valid" CHECK(("provider_media_deliveries"."last_attempt_at" is null or "provider_media_deliveries"."last_attempt_at" >= "provider_media_deliveries"."created_at")
                and ("provider_media_deliveries"."completed_at" is null or "provider_media_deliveries"."completed_at" >= "provider_media_deliveries"."created_at")
                and ("provider_media_deliveries"."remote_media_expires_at" is null
                    or ("provider_media_deliveries"."completed_at" is not null and "provider_media_deliveries"."remote_media_expires_at" >= "provider_media_deliveries"."completed_at"))),
	CONSTRAINT "provider_media_deliveries_state_data_valid" CHECK(("provider_media_deliveries"."state" = 'pending'
                    and "provider_media_deliveries"."attempts" >= 0
                    and ("provider_media_deliveries"."last_attempt_at" is null or "provider_media_deliveries"."last_attempt_at" >= "provider_media_deliveries"."created_at")
                    and "provider_media_deliveries"."completed_at" is null
                    and "provider_media_deliveries"."remote_media_id" is null
                    and "provider_media_deliveries"."remote_media_url" is null
                    and "provider_media_deliveries"."remote_media_expires_at" is null
                    and "provider_media_deliveries"."error_code" is null
                    and "provider_media_deliveries"."error_message" is null)
                or ("provider_media_deliveries"."state" = 'uploading'
                    and "provider_media_deliveries"."attempts" > 0
                    and "provider_media_deliveries"."last_attempt_at" is not null
                    and "provider_media_deliveries"."completed_at" is null
                    and "provider_media_deliveries"."remote_media_expires_at" is null
                    and "provider_media_deliveries"."error_code" is null
                    and "provider_media_deliveries"."error_message" is null)
                or ("provider_media_deliveries"."state" = 'uploaded'
                    and "provider_media_deliveries"."attempts" > 0
                    and "provider_media_deliveries"."completed_at" is not null
                    and "provider_media_deliveries"."remote_media_id" is not null
                    and length(trim("provider_media_deliveries"."remote_media_id")) > 0
                    and ("provider_media_deliveries"."remote_media_expires_at" is null
                        or "provider_media_deliveries"."remote_media_expires_at" >= "provider_media_deliveries"."completed_at")
                    and "provider_media_deliveries"."error_code" is null
                    and "provider_media_deliveries"."error_message" is null)
                or ("provider_media_deliveries"."state" in ('failed', 'ambiguous')
                    and "provider_media_deliveries"."attempts" > 0
                    and "provider_media_deliveries"."completed_at" is not null
                    and "provider_media_deliveries"."remote_media_expires_at" is null
                    and "provider_media_deliveries"."error_code" is not null
                    and length(trim("provider_media_deliveries"."error_code")) > 0
                    and "provider_media_deliveries"."error_message" is not null
                    and length(trim("provider_media_deliveries"."error_message")) > 0)),
	CONSTRAINT "provider_media_deliveries_url_valid" CHECK("provider_media_deliveries"."remote_media_url" is null or length(trim("provider_media_deliveries"."remote_media_url")) > 0)
);

CREATE UNIQUE INDEX "provider_media_deliveries_execution_provider_uidx" ON "provider_media_deliveries" ("project_id","execution_media_id","publisher_id","provider_id");

CREATE UNIQUE INDEX "provider_media_deliveries_project_id_id_uidx" ON "provider_media_deliveries" ("project_id","id");

CREATE INDEX "provider_media_deliveries_project_state_idx" ON "provider_media_deliveries" ("project_id","state");

CREATE TABLE "publication_approval_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"publication_id" text NOT NULL,
	"target_revision_id" text NOT NULL,
	"draft_revision" bigint NOT NULL,
	"proposed_scheduled_at" bigint NOT NULL,
	"state" text NOT NULL,
	"requested_by_actor_id" text NOT NULL,
	"decided_by_actor_id" text,
	"decided_at" bigint,
	"scheduled_at" bigint,
	"rejection_reason" text,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","publication_id") REFERENCES "publications"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","target_revision_id") REFERENCES "publication_target_revisions"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","requested_by_actor_id") REFERENCES "actors"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","decided_by_actor_id") REFERENCES "actors"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
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

CREATE UNIQUE INDEX "publication_approval_requests_one_pending_per_publication_uidx" ON "publication_approval_requests" ("project_id","publication_id") WHERE "publication_approval_requests"."state" = 'pending';

CREATE UNIQUE INDEX "publication_approval_requests_project_id_id_uidx" ON "publication_approval_requests" ("project_id","id");

CREATE INDEX "publication_approval_requests_project_publication_created_idx" ON "publication_approval_requests" ("project_id","publication_id","created_at");

CREATE INDEX "publication_approval_requests_project_state_created_idx" ON "publication_approval_requests" ("project_id","state","created_at");

CREATE TABLE "publication_cadence_overrides" (
	"publication_id" text PRIMARY KEY NOT NULL,
	"rules_revision" bigint NOT NULL,
	"scheduled_at" bigint NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	FOREIGN KEY ("publication_id") REFERENCES "publications"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE "publication_comment_replies" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"publication_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"root_uri" text NOT NULL,
	"parent_uri" text NOT NULL,
	"text" text NOT NULL,
	"connection_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"account_id" text NOT NULL,
	"record_key" text NOT NULL,
	"state" text NOT NULL,
	"attempts" bigint DEFAULT 0 NOT NULL,
	"claim_token" text,
	"lease_expires_at" bigint,
	"effect_started_at" bigint,
	"external_id" text,
	"external_url" text,
	"last_error" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL, "provider_id" text DEFAULT 'bluesky' NOT NULL, "instance_origin" text,
	FOREIGN KEY ("project_id","publication_id") REFERENCES "publications"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","actor_id") REFERENCES "actors"("project_id","id") ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "publication_comment_replies_state_valid" CHECK("publication_comment_replies"."state" in ('pending', 'running', 'sent', 'failed', 'ambiguous')),
	CONSTRAINT "publication_comment_replies_text_nonblank" CHECK(length(trim("publication_comment_replies"."text")) > 0),
	CONSTRAINT "publication_comment_replies_attempts_valid" CHECK("publication_comment_replies"."attempts" >= 0),
	CONSTRAINT "publication_comment_replies_time_valid" CHECK("publication_comment_replies"."created_at" >= 0 and "publication_comment_replies"."updated_at" >= "publication_comment_replies"."created_at"),
	CONSTRAINT "publication_comment_replies_claim_valid" CHECK(("publication_comment_replies"."state" = 'running' and "publication_comment_replies"."claim_token" is not null and "publication_comment_replies"."lease_expires_at" is not null) or ("publication_comment_replies"."state" != 'running' and "publication_comment_replies"."claim_token" is null and "publication_comment_replies"."lease_expires_at" is null))
);

CREATE INDEX "publication_comment_replies_due" ON "publication_comment_replies" ("state","created_at");

CREATE INDEX "publication_comment_replies_history" ON "publication_comment_replies" ("project_id","publication_id","created_at");

CREATE UNIQUE INDEX "publication_comment_replies_record" ON "publication_comment_replies" ("provider_id","account_id","record_key");

CREATE TABLE "publication_comment_snapshots" (
	"project_id" text NOT NULL,
	"publication_id" text NOT NULL,
	"root_uri" text NOT NULL,
	"snapshot_json" text,
	"last_attempt_at" bigint NOT NULL,
	"last_error" text,
	PRIMARY KEY("project_id", "publication_id"),
	FOREIGN KEY ("project_id","publication_id") REFERENCES "publications"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "publication_comment_snapshots_attempt_nonnegative" CHECK("publication_comment_snapshots"."last_attempt_at" >= 0)
);

CREATE TABLE "publication_composer_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"owner_actor_id" text NOT NULL,
	"content_json" text NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","owner_actor_id") REFERENCES "actors"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "publication_composer_drafts_content_object" CHECK(json_valid("publication_composer_drafts"."content_json") and json_type("publication_composer_drafts"."content_json") = 'object'),
	CONSTRAINT "publication_composer_drafts_revision_positive" CHECK("publication_composer_drafts"."revision" > 0)
);

CREATE UNIQUE INDEX "publication_composer_drafts_project_actor_uidx" ON "publication_composer_drafts" ("project_id","owner_actor_id");

CREATE TABLE "publication_draft_adoptions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"publication_id" text NOT NULL,
	"profile_version_id" text NOT NULL,
	"adopted_profile_version_id" text NOT NULL,
	"snapshot_json" text NOT NULL,
	"local_content_json" text,
	"target_revision_id" text NOT NULL,
	"created_by_actor_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","publication_id") REFERENCES "publications"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","profile_version_id") REFERENCES project_channel_profiles(project_id,profile_id) ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","adopted_profile_version_id") REFERENCES project_channel_profiles(project_id,profile_id) ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","created_by_actor_id") REFERENCES "actors"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","target_revision_id") REFERENCES "publication_target_revisions"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "publication_draft_adoptions_snapshot_object" CHECK(json_valid("publication_draft_adoptions"."snapshot_json") and json_type("publication_draft_adoptions"."snapshot_json") = 'object'),
	CONSTRAINT "publication_draft_adoptions_local_object" CHECK("publication_draft_adoptions"."local_content_json" is null or (json_valid("publication_draft_adoptions"."local_content_json") and json_type("publication_draft_adoptions"."local_content_json") = 'object'))
);

CREATE INDEX "publication_draft_adoptions_publication_idx" ON "publication_draft_adoptions" ("project_id","publication_id");


CREATE TABLE "publication_first_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"publication_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"text" text NOT NULL,
	"delay_seconds" bigint NOT NULL,
	"state" text NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"due_at" bigint,
	"root_uri" text,
	"execution_revision_id" text,
	"connection_id" text,
	"credential_id" text,
	"account_id" text,
	"record_key" text NOT NULL,
	"attempts" bigint DEFAULT 0 NOT NULL,
	"claim_token" text,
	"lease_expires_at" bigint,
	"effect_started_at" bigint,
	"external_id" text,
	"external_url" text,
	"last_error" text,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL, "provider_id" text DEFAULT 'bluesky' NOT NULL, "instance_origin" text,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","publication_id") REFERENCES "publications"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","actor_id") REFERENCES "actors"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "publication_first_comments_state_valid" CHECK("publication_first_comments"."state" in ('waiting', 'pending', 'running', 'suspended', 'sent', 'failed', 'ambiguous', 'cancelled')),
	CONSTRAINT "publication_first_comments_text_nonblank" CHECK(length(trim("publication_first_comments"."text")) > 0),
	CONSTRAINT "publication_first_comments_delay_seconds_valid" CHECK("publication_first_comments"."delay_seconds" >= 0 and "publication_first_comments"."delay_seconds" <= 604800),
	CONSTRAINT "publication_first_comments_attempts_valid" CHECK("publication_first_comments"."attempts" >= 0),
	CONSTRAINT "publication_first_comments_revision_valid" CHECK("publication_first_comments"."revision" > 0),
	CONSTRAINT "publication_first_comments_record_key_nonblank" CHECK(length(trim("publication_first_comments"."record_key")) > 0),
	CONSTRAINT "publication_first_comments_time_valid" CHECK("publication_first_comments"."created_at" >= 0 and "publication_first_comments"."updated_at" >= "publication_first_comments"."created_at"),
	CONSTRAINT "publication_first_comments_claim_valid" CHECK(("publication_first_comments"."state" = 'running' and "publication_first_comments"."claim_token" is not null and "publication_first_comments"."lease_expires_at" is not null) or ("publication_first_comments"."state" != 'running' and "publication_first_comments"."claim_token" is null and "publication_first_comments"."lease_expires_at" is null)),
	CONSTRAINT "publication_first_comments_armed_identity" CHECK("publication_first_comments"."state" not in ('pending', 'running') or ("publication_first_comments"."due_at" is not null and "publication_first_comments"."root_uri" is not null and "publication_first_comments"."execution_revision_id" is not null and "publication_first_comments"."connection_id" is not null and "publication_first_comments"."credential_id" is not null and "publication_first_comments"."account_id" is not null)),
	CONSTRAINT "publication_first_comments_external_result_only_sent" CHECK(("publication_first_comments"."external_id" is null and "publication_first_comments"."external_url" is null) or "publication_first_comments"."state" = 'sent')
);

CREATE INDEX "publication_first_comments_project_publication_idx" ON "publication_first_comments" ("project_id","publication_id");

CREATE UNIQUE INDEX "publication_first_comments_project_publication_uidx" ON "publication_first_comments" ("project_id","publication_id");

CREATE UNIQUE INDEX "publication_first_comments_project_record_key_uidx" ON "publication_first_comments" ("project_id","record_key");

CREATE INDEX "publication_first_comments_state_due_at_idx" ON "publication_first_comments" ("state","due_at");

CREATE TABLE "publication_moves" (
	"project_id" text NOT NULL,
	"source_publication_id" text PRIMARY KEY NOT NULL,
	"destination_publication_id" text NOT NULL,
	"requested_scheduled_at" bigint,
	"created_by_actor_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","source_publication_id") REFERENCES "publications"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","destination_publication_id") REFERENCES "publications"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","created_by_actor_id") REFERENCES "actors"("project_id","id") ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "publication_moves_distinct" CHECK("publication_moves"."source_publication_id" <> "publication_moves"."destination_publication_id")
);

CREATE UNIQUE INDEX "publication_moves_destination_publication_id_unique" ON "publication_moves" ("destination_publication_id");

CREATE INDEX "publication_moves_project_idx" ON "publication_moves" ("project_id");

CREATE TABLE "publication_tags" (
	"project_id" text NOT NULL,
	"publication_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	PRIMARY KEY("project_id", "publication_id", "tag_id"),
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","publication_id") REFERENCES "publications"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","tag_id") REFERENCES "project_tags"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "publication_tags_publication_id_nonblank" CHECK(length(trim("publication_tags"."publication_id")) > 0),
	CONSTRAINT "publication_tags_tag_id_nonblank" CHECK(length(trim("publication_tags"."tag_id")) > 0)
);

CREATE INDEX "publication_tags_project_publication_idx" ON "publication_tags" ("project_id","publication_id");

CREATE INDEX "publication_tags_project_tag_idx" ON "publication_tags" ("project_id","tag_id");

CREATE TABLE "publication_working_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"publication_id" text NOT NULL,
	"profile_version_id" text NOT NULL,
	"source_revision" bigint NOT NULL,
	"base_source_content" text DEFAULT '{}' NOT NULL,
	"content_json" text NOT NULL,
	"review_state" text NOT NULL,
	"validation_issues_json" text NOT NULL,
	"last_assessed_profile_version_id" text,
	"revision" bigint DEFAULT 1 NOT NULL,
	"updated_by_actor_id" text NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","publication_id") REFERENCES "publications"("project_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","profile_version_id") REFERENCES project_channel_profiles(project_id,profile_id) ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","last_assessed_profile_version_id") REFERENCES project_channel_profiles(project_id,profile_id) ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("project_id","updated_by_actor_id") REFERENCES "actors"("project_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "publication_working_drafts_source_revision_positive" CHECK("publication_working_drafts"."source_revision" > 0),
	CONSTRAINT "publication_working_drafts_content_object" CHECK(json_valid("publication_working_drafts"."content_json") and json_type("publication_working_drafts"."content_json") = 'object'),
	CONSTRAINT "publication_working_drafts_validation_issues_array" CHECK(json_valid("publication_working_drafts"."validation_issues_json") and json_type("publication_working_drafts"."validation_issues_json") = 'array'),
	CONSTRAINT "publication_working_drafts_review_state_valid" CHECK("publication_working_drafts"."review_state" in ('compatible', 'review_required')),
	CONSTRAINT "publication_working_drafts_revision_positive" CHECK("publication_working_drafts"."revision" > 0)
);

CREATE UNIQUE INDEX "publication_working_drafts_project_publication_uidx" ON "publication_working_drafts" ("project_id","publication_id");

CREATE INDEX "publication_working_drafts_project_review_idx" ON "publication_working_drafts" ("project_id","review_state");

CREATE TABLE "publisher_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"external_account_id" text NOT NULL,
	"external_account_name" text,
	"scopes" text NOT NULL,
	"state" text NOT NULL,
	"expires_at" bigint,
	"connected_by_actor_id" text NOT NULL,
	"provider_application_id" text,
	"encryption_version" bigint,
	"encryption_key_id" text,
	"access_token_ciphertext" blob,
	"access_token_nonce" blob,
	"refresh_token_ciphertext" blob,
	"refresh_token_nonce" blob,
	"provider_session_ciphertext" blob,
	"provider_session_nonce" blob,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("workspace_id","connected_by_actor_id") REFERENCES "actors"("workspace_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("provider_id","provider_application_id") REFERENCES "provider_application_configurations"("provider_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "publisher_credentials_provider_nonblank" CHECK(length(trim("publisher_credentials"."provider_id")) > 0),
	CONSTRAINT "publisher_credentials_external_account_nonblank" CHECK(length(trim("publisher_credentials"."external_account_id")) > 0),
	CONSTRAINT "publisher_credentials_external_name_nonblank" CHECK("publisher_credentials"."external_account_name" is null or length(trim("publisher_credentials"."external_account_name")) > 0),
	CONSTRAINT "publisher_credentials_scopes_json_array" CHECK(json_valid("publisher_credentials"."scopes") and json_type("publisher_credentials"."scopes") = 'array'),
	CONSTRAINT "publisher_credentials_state_valid" CHECK("publisher_credentials"."state" in ('active', 'reconnect_required', 'revoked')),
	CONSTRAINT "publisher_credentials_expiry_valid" CHECK("publisher_credentials"."expires_at" is null or "publisher_credentials"."expires_at" >= 0),
	CONSTRAINT "publisher_credentials_encryption_version_valid" CHECK("publisher_credentials"."encryption_version" is null or "publisher_credentials"."encryption_version" > 0),
	CONSTRAINT "publisher_credentials_encryption_key_nonblank" CHECK("publisher_credentials"."encryption_key_id" is null or length(trim("publisher_credentials"."encryption_key_id")) > 0),
	CONSTRAINT "publisher_credentials_secret_state_valid" CHECK((
                    "publisher_credentials"."state" in ('active', 'reconnect_required')
                    and "publisher_credentials"."encryption_version" is not null
                    and "publisher_credentials"."encryption_key_id" is not null
                    and "publisher_credentials"."access_token_ciphertext" is not null
                    and "publisher_credentials"."access_token_nonce" is not null
                    and length("publisher_credentials"."access_token_ciphertext") > 16
                    and length("publisher_credentials"."access_token_nonce") = 12
                ) or (
                    "publisher_credentials"."state" = 'revoked'
                    and "publisher_credentials"."encryption_version" is null
                    and "publisher_credentials"."encryption_key_id" is null
                    and "publisher_credentials"."access_token_ciphertext" is null
                    and "publisher_credentials"."access_token_nonce" is null
                    and "publisher_credentials"."refresh_token_ciphertext" is null
                    and "publisher_credentials"."refresh_token_nonce" is null
                    and "publisher_credentials"."provider_session_ciphertext" is null
                    and "publisher_credentials"."provider_session_nonce" is null
                )),
	CONSTRAINT "publisher_credentials_refresh_token_envelope_valid" CHECK(("publisher_credentials"."refresh_token_ciphertext" is null and "publisher_credentials"."refresh_token_nonce" is null)
                or ("publisher_credentials"."refresh_token_ciphertext" is not null
                    and "publisher_credentials"."refresh_token_nonce" is not null
                    and length("publisher_credentials"."refresh_token_ciphertext") > 16
                    and length("publisher_credentials"."refresh_token_nonce") = 12)),
	CONSTRAINT "publisher_credentials_provider_session_envelope_valid" CHECK(("publisher_credentials"."provider_session_ciphertext" is null and "publisher_credentials"."provider_session_nonce" is null)
                or ("publisher_credentials"."provider_session_ciphertext" is not null
                    and "publisher_credentials"."provider_session_nonce" is not null
                    and length("publisher_credentials"."provider_session_ciphertext") > 16
                    and length("publisher_credentials"."provider_session_nonce") = 12)),
	CONSTRAINT "publisher_credentials_revision_valid" CHECK("publisher_credentials"."revision" > 0)
);

CREATE INDEX "publisher_credentials_workspace_actor_idx" ON "publisher_credentials" ("workspace_id","connected_by_actor_id");

CREATE UNIQUE INDEX "publisher_credentials_workspace_id_id_uidx" ON "publisher_credentials" ("workspace_id","id");

CREATE INDEX publisher_credentials_workspace_provider_external_idx ON publisher_credentials(workspace_id,provider_id,external_account_id);

CREATE INDEX "publisher_credentials_workspace_state_expires_idx" ON "publisher_credentials" ("workspace_id","state","expires_at");

CREATE TABLE "publisher_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"publisher_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"endpoint_url" text,
	"authentication_json" text,
	"destination_type" text,
	"destination_id" text,
	"destination_name" text,
	"connected_by_actor_id" text NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("workspace_id","publisher_id") REFERENCES "publishers"("workspace_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("workspace_id","credential_id") REFERENCES "publisher_credentials"("workspace_id","id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("workspace_id","connected_by_actor_id") REFERENCES "actors"("workspace_id","id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "publisher_connections_endpoint_url_nonblank" CHECK("publisher_connections"."endpoint_url" is null or length(trim("publisher_connections"."endpoint_url")) > 0),
	CONSTRAINT "publisher_connections_authentication_json_object" CHECK("publisher_connections"."authentication_json" is null or (json_valid("publisher_connections"."authentication_json") and json_type("publisher_connections"."authentication_json") = 'object')),
	CONSTRAINT "publisher_connections_destination_pair_valid" CHECK((
                ("publisher_connections"."destination_type" is null and "publisher_connections"."destination_id" is null and "publisher_connections"."destination_name" is null)
                or ("publisher_connections"."destination_type" is not null
                    and length(trim("publisher_connections"."destination_type")) > 0
                    and "publisher_connections"."destination_id" is not null
                    and length(trim("publisher_connections"."destination_id")) > 0
                    and ("publisher_connections"."destination_name" is null or length(trim("publisher_connections"."destination_name")) > 0))
            ))
);

CREATE INDEX "publisher_connections_credential_id_idx" ON "publisher_connections" ("credential_id");

CREATE INDEX "publisher_connections_workspace_id_actor_id_idx" ON "publisher_connections" ("workspace_id","connected_by_actor_id");

CREATE UNIQUE INDEX "publisher_connections_workspace_id_publisher_id_uidx" ON "publisher_connections" ("workspace_id","publisher_id");

CREATE TABLE "resource_cleanup_objects" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"workspace_id" text,
	"store_id" text NOT NULL,
	"object_key" text NOT NULL,
	"attempts" bigint DEFAULT 0 NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "resource_cleanup_attempts_valid" CHECK("resource_cleanup_objects"."attempts" >= 0)
);

CREATE INDEX "resource_cleanup_project_idx" ON "resource_cleanup_objects" ("project_id");

CREATE INDEX "resource_cleanup_updated_idx" ON "resource_cleanup_objects" ("updated_at");

CREATE INDEX "resource_cleanup_workspace_idx" ON "resource_cleanup_objects" ("workspace_id");

CREATE TABLE "resource_lifecycle_events" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"resource_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_id" text NOT NULL,
	"impact_json" text NOT NULL,
	"created_at" bigint NOT NULL
);

CREATE TABLE "resource_lifecycles" (
	"kind" text NOT NULL,
	"resource_id" text NOT NULL,
	"name" text NOT NULL,
	"state" text NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"actor_id" text NOT NULL,
	"impact_json" text NOT NULL,
	"updated_at" bigint NOT NULL,
	PRIMARY KEY("kind", "resource_id"),
	CONSTRAINT "resource_lifecycles_kind_valid" CHECK("resource_lifecycles"."kind" in ('project', 'workspace')),
	CONSTRAINT "resource_lifecycles_state_valid" CHECK("resource_lifecycles"."state" in ('active', 'archiving', 'archived', 'deleting', 'deleted')),
	CONSTRAINT "resource_lifecycles_revision_valid" CHECK("resource_lifecycles"."revision" > 0),
	CONSTRAINT "resource_lifecycles_impact_valid" CHECK(json_valid("resource_lifecycles"."impact_json") and json_type("resource_lifecycles"."impact_json") = 'object')
);

CREATE INDEX "resource_lifecycles_state_updated_idx" ON "resource_lifecycles" ("state","updated_at");

CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" bigint NOT NULL,
	"token" text NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"impersonated_by" text,
	"active_organization_id" text,
	"user_id" text NOT NULL, "active_team_id" text,
	FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE
);

CREATE UNIQUE INDEX "session_token_unique" ON "session" ("token");

CREATE INDEX "session_userId_idx" ON "session" ("user_id");

CREATE TABLE "team_member" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"membership_key" text,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("team_id") REFERENCES "team"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE,
	FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE no action ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE
);

CREATE UNIQUE INDEX "team_member_membership_key_unique" ON "team_member" ("membership_key");

CREATE INDEX "team_member_team_id_idx" ON "team_member" ("team_id");

CREATE UNIQUE INDEX "team_member_team_user_uidx" ON "team_member" ("team_id","user_id");

CREATE INDEX "team_member_user_id_idx" ON "team_member" ("user_id");

CREATE TABLE "user_avatars" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"state" text NOT NULL,
	"store_id" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "user_avatars_state_valid" CHECK("user_avatars"."state" in ('pending', 'ready', 'retired')),
	CONSTRAINT "user_avatars_size_valid" CHECK("user_avatars"."byte_size" > 0 and "user_avatars"."byte_size" <= 5242880)
);

CREATE UNIQUE INDEX "user_avatars_object_key_unique" ON "user_avatars" ("object_key");

CREATE INDEX "user_avatars_owner_state" ON "user_avatars" ("user_id","state");

CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL,
	"updated_at" bigint DEFAULT (cast(unixepoch('subsecond') * 1000 as bigint)) NOT NULL
);

CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");

-- postdot:common
CREATE VIEW project_publisher_credential_contexts AS
 SELECT p.id AS project_id,c.* FROM projects p JOIN publisher_credentials c ON c.workspace_id=p.workspace_id
 WHERE EXISTS(SELECT 1 FROM publisher_connections connection JOIN publishers publisher ON publisher.workspace_id=connection.workspace_id AND publisher.id=connection.publisher_id JOIN project_channel_attachments a ON a.workspace_id=publisher.workspace_id AND a.channel_id=publisher.channel_id WHERE a.project_id=p.id AND connection.credential_id=c.id)
 -- A credential not yet connected to any destination is staged by the project whose flow created it
 -- (provenance, not authorization: the caller's live project access is still checked above this layer).
 OR (NOT EXISTS(SELECT 1 FROM publisher_connections unconnected WHERE unconnected.credential_id=c.id)
 AND EXISTS(SELECT 1 FROM actors staged JOIN actors origin ON origin.id=staged.origin_actor_id WHERE staged.workspace_id=c.workspace_id AND staged.id=c.connected_by_actor_id AND origin.project_id=p.id));

CREATE VIEW project_active_publisher_credential_contexts AS
 SELECT c.* FROM project_publisher_credential_contexts c
 WHERE EXISTS(SELECT 1 FROM publisher_connections connection JOIN publishers publisher ON publisher.workspace_id=connection.workspace_id AND publisher.id=connection.publisher_id JOIN project_channel_attachments a ON a.workspace_id=publisher.workspace_id AND a.channel_id=publisher.channel_id WHERE a.project_id=c.project_id AND a.state='active' AND connection.credential_id=c.id)
 OR NOT EXISTS(SELECT 1 FROM publisher_connections unconnected WHERE unconnected.credential_id=c.id);

CREATE VIEW project_channel_contexts AS
 SELECT a.project_id,c.*,a.state AS attachment_state,a.revision AS attachment_revision FROM project_channel_attachments a JOIN channels c ON c.workspace_id=a.workspace_id AND c.id=a.channel_id;

CREATE VIEW project_channel_profile_contexts AS
 -- Historical readers still need the channel's current metadata after detach.
 -- This view is not admission: new references use the active-derived bindings.
 SELECT a.project_id,p.* FROM project_channel_attachments a JOIN channel_profile_versions p ON p.workspace_id=a.workspace_id AND p.channel_id=a.channel_id;

CREATE VIEW project_publisher_connection_contexts AS
 SELECT b.project_id,c.* FROM project_channel_publishers b JOIN publishers p ON p.channel_id=b.channel_id AND p.id=b.publisher_id JOIN publisher_connections c ON c.workspace_id=p.workspace_id AND c.publisher_id=p.id;

CREATE VIEW project_publisher_contexts AS
 SELECT b.project_id,p.* FROM project_channel_publishers b JOIN publishers p ON p.channel_id=b.channel_id AND p.id=b.publisher_id;

-- postdot:sqlite
CREATE TRIGGER "actors_cleanup_after_project_delete" AFTER DELETE ON "projects"
BEGIN DELETE FROM actors WHERE project_id = OLD.id; END;

CREATE TRIGGER "actors_cleanup_after_workspace_delete" AFTER DELETE ON "workspaces"
BEGIN DELETE FROM actors WHERE workspace_id = OLD.id; END;

CREATE TRIGGER channel_profile_versions_archived_insert BEFORE INSERT ON channel_profile_versions
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'workspace' AND resource_id = NEW.workspace_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

CREATE TRIGGER channel_profile_versions_archived_update BEFORE UPDATE ON channel_profile_versions
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'workspace' AND resource_id = NEW.workspace_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

CREATE TRIGGER channels_archived_insert BEFORE INSERT ON channels
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'workspace' AND resource_id = NEW.workspace_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

CREATE TRIGGER channels_archived_update BEFORE UPDATE ON channels
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'workspace' AND resource_id = NEW.workspace_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

CREATE TRIGGER jobs_lifecycle_admission BEFORE UPDATE OF state ON jobs
WHEN NEW.state = 'running' AND OLD.state <> 'running' AND EXISTS (
 SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active'
) BEGIN SELECT RAISE(IGNORE); END;

CREATE TRIGGER media_assets_retirement_insert BEFORE INSERT ON media_assets
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

CREATE TRIGGER media_representations_retirement_insert BEFORE INSERT ON media_representations
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

CREATE TRIGGER media_upload_intents_retirement_insert BEFORE INSERT ON media_upload_intents
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

CREATE TRIGGER notification_deliveries_lifecycle_admission BEFORE UPDATE OF state ON notification_deliveries
WHEN NEW.state = 'running' AND OLD.state <> 'running' AND EXISTS (
 SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active'
) BEGIN SELECT RAISE(IGNORE); END;

CREATE TRIGGER notification_deliveries_retirement_insert BEFORE INSERT ON notification_deliveries
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(IGNORE); END;

CREATE TRIGGER posts_archived_insert BEFORE INSERT ON posts
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

CREATE TRIGGER posts_archived_update BEFORE UPDATE ON posts
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

CREATE TRIGGER project_channel_profiles_on_attachment AFTER INSERT ON project_channel_attachments BEGIN
 INSERT INTO project_channel_profiles SELECT NEW.project_id,NEW.channel_id,p.id FROM channel_profile_versions p WHERE p.channel_id=NEW.channel_id AND NEW.state='active'; END;

CREATE TRIGGER project_channel_profiles_on_reattach AFTER UPDATE OF state ON project_channel_attachments
WHEN NEW.state='active' AND OLD.state='detached'
BEGIN INSERT INTO project_channel_profiles SELECT NEW.project_id,NEW.channel_id,p.id FROM channel_profile_versions p WHERE p.channel_id=NEW.channel_id AND NOT EXISTS(SELECT 1 FROM project_channel_profiles b WHERE b.project_id=NEW.project_id AND b.profile_id=p.id); END;

CREATE TRIGGER project_channel_profiles_on_resource AFTER INSERT ON channel_profile_versions BEGIN
 INSERT INTO project_channel_profiles SELECT a.project_id,a.channel_id,NEW.id FROM project_channel_attachments a WHERE a.channel_id=NEW.channel_id AND a.state='active'; END;

CREATE TRIGGER project_channel_publishers_on_attachment AFTER INSERT ON project_channel_attachments BEGIN
 INSERT INTO project_channel_publishers SELECT NEW.project_id,NEW.channel_id,p.id FROM publishers p WHERE p.channel_id=NEW.channel_id AND NEW.state='active'; END;

CREATE TRIGGER project_channel_publishers_on_reattach AFTER UPDATE OF state ON project_channel_attachments
WHEN NEW.state='active' AND OLD.state='detached'
BEGIN INSERT INTO project_channel_publishers SELECT NEW.project_id,NEW.channel_id,p.id FROM publishers p WHERE p.channel_id=NEW.channel_id AND NOT EXISTS(SELECT 1 FROM project_channel_publishers b WHERE b.project_id=NEW.project_id AND b.publisher_id=p.id); END;

CREATE TRIGGER project_channel_publishers_on_resource AFTER INSERT ON publishers BEGIN
 INSERT INTO project_channel_publishers SELECT a.project_id,a.channel_id,NEW.id FROM project_channel_attachments a WHERE a.channel_id=NEW.channel_id AND a.state='active'; END;

CREATE TRIGGER projects_lifecycle_identity BEFORE INSERT ON projects
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'resource_identity_reserved'); END;

CREATE TRIGGER publication_comment_replies_archived_insert BEFORE INSERT ON publication_comment_replies
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

CREATE TRIGGER publication_comment_replies_archived_update BEFORE UPDATE ON publication_comment_replies
WHEN OLD.state <> 'running' AND EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

CREATE TRIGGER publication_comment_replies_lifecycle_admission BEFORE UPDATE OF state ON publication_comment_replies
WHEN NEW.state = 'running' AND OLD.state <> 'running' AND EXISTS (
 SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active'
) BEGIN SELECT RAISE(IGNORE); END;

CREATE TRIGGER publication_composer_drafts_archived_insert BEFORE INSERT ON publication_composer_drafts
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

CREATE TRIGGER publication_composer_drafts_archived_update BEFORE UPDATE ON publication_composer_drafts
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

CREATE TRIGGER publication_first_comments_lifecycle_admission BEFORE UPDATE OF state ON publication_first_comments
WHEN NEW.state = 'running' AND OLD.state <> 'running' AND EXISTS (
 SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active'
) BEGIN SELECT RAISE(IGNORE); END;

CREATE TRIGGER publication_first_comments_retirement_insert BEFORE INSERT ON publication_first_comments
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

CREATE TRIGGER publication_moves_immutable BEFORE UPDATE ON publication_moves
BEGIN SELECT RAISE(ABORT,'Publication move history is immutable'); END;

CREATE TRIGGER publication_moves_same_post BEFORE INSERT ON publication_moves
WHEN (SELECT post_id FROM publications WHERE project_id=NEW.project_id AND id=NEW.source_publication_id)
    IS NOT (SELECT post_id FROM publications WHERE project_id=NEW.project_id AND id=NEW.destination_publication_id)
BEGIN SELECT RAISE(ABORT,'A publication move must retain its source post'); END;

CREATE TRIGGER publication_target_revisions_archived_insert BEFORE INSERT ON publication_target_revisions
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

CREATE TRIGGER publication_target_revisions_archived_update BEFORE UPDATE ON publication_target_revisions
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

CREATE TRIGGER publication_working_drafts_archived_insert BEFORE INSERT ON publication_working_drafts
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

CREATE TRIGGER publication_working_drafts_archived_update BEFORE UPDATE ON publication_working_drafts
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

CREATE TRIGGER publications_retirement_insert BEFORE INSERT ON publications
WHEN NEW.state IN ('draft', 'scheduled', 'ready') AND EXISTS (
 SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active'
) BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

CREATE TRIGGER publications_retirement_update BEFORE UPDATE ON publications
WHEN OLD.state <> 'publishing' AND NEW.state IN ('draft', 'scheduled', 'ready') AND EXISTS (
 SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active'
) BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

CREATE TRIGGER publisher_connections_retirement_insert BEFORE INSERT ON publisher_connections
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'workspace' AND resource_id = NEW.workspace_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

CREATE TRIGGER publishers_retirement_insert BEFORE INSERT ON publishers
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'workspace' AND resource_id = NEW.workspace_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

CREATE TRIGGER shared_channel_attachment_identity_immutable BEFORE UPDATE OF project_id,channel_id,workspace_id ON project_channel_attachments
 WHEN NEW.project_id<>OLD.project_id OR NEW.channel_id<>OLD.channel_id OR NEW.workspace_id<>OLD.workspace_id
 BEGIN SELECT RAISE(ABORT,'attachment_identity_immutable'); END;

CREATE TRIGGER shared_channels_cleanup_project_attachments AFTER DELETE ON projects BEGIN
 DELETE FROM project_channel_attachments WHERE project_id=OLD.id; END;

CREATE TRIGGER shared_channels_detach_manager AFTER UPDATE OF state ON project_channel_attachments
WHEN NEW.state='detached'
BEGIN DELETE FROM channel_managers WHERE project_id=NEW.project_id AND channel_id=NEW.channel_id; END;

CREATE TRIGGER shared_channels_jobs_effect_admission BEFORE UPDATE OF effect_started_at ON jobs
WHEN OLD.effect_started_at IS NULL AND NEW.effect_started_at IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM publications p JOIN project_channel_attachments a ON a.project_id=p.project_id AND a.channel_id=p.channel_id
 WHERE p.project_id=NEW.project_id AND p.id=NEW.publication_id AND a.state='active'
)
BEGIN SELECT RAISE(IGNORE); END;

CREATE TRIGGER shared_channels_manager_insert BEFORE INSERT ON channel_managers
WHEN NOT EXISTS(SELECT 1 FROM project_channel_attachments a WHERE a.project_id=NEW.project_id AND a.channel_id=NEW.channel_id AND a.state='active')
BEGIN SELECT RAISE(ABORT,'manager_requires_active_attachment'); END;

CREATE TRIGGER shared_channels_manager_update BEFORE UPDATE ON channel_managers
WHEN NOT EXISTS(SELECT 1 FROM project_channel_attachments a WHERE a.project_id=NEW.project_id AND a.channel_id=NEW.channel_id AND a.state='active')
BEGIN SELECT RAISE(ABORT,'manager_requires_active_attachment'); END;

CREATE TRIGGER shared_channels_publication_admission BEFORE INSERT ON publications
WHEN NOT EXISTS (SELECT 1 FROM project_channel_attachments a WHERE a.project_id=NEW.project_id AND a.channel_id=NEW.channel_id AND a.state='active')
BEGIN SELECT RAISE(ABORT,'channel_detached'); END;

CREATE TRIGGER shared_channels_publication_comment_replies_effect_admission BEFORE UPDATE OF effect_started_at ON publication_comment_replies
WHEN OLD.effect_started_at IS NULL AND NEW.effect_started_at IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM publications p JOIN project_channel_attachments a ON a.project_id=p.project_id AND a.channel_id=p.channel_id
 WHERE p.project_id=NEW.project_id AND p.id=NEW.publication_id AND a.state='active'
)
BEGIN SELECT RAISE(IGNORE); END;

CREATE TRIGGER shared_channels_publication_first_comments_effect_admission BEFORE UPDATE OF effect_started_at ON publication_first_comments
WHEN OLD.effect_started_at IS NULL AND NEW.effect_started_at IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM publications p JOIN project_channel_attachments a ON a.project_id=p.project_id AND a.channel_id=p.channel_id
 WHERE p.project_id=NEW.project_id AND p.id=NEW.publication_id AND a.state='active'
)
BEGIN SELECT RAISE(IGNORE); END;

CREATE TRIGGER workspaces_lifecycle_identity BEFORE INSERT ON workspaces
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'workspace' AND resource_id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'resource_identity_reserved'); END;

-- postdot:postgres
create function actors_cleanup_after_project_delete_fn() returns trigger language plpgsql as $$
begin
    DELETE FROM actors WHERE project_id = OLD.id;
    return null;
end
$$;
create trigger actors_cleanup_after_project_delete after delete on "projects"
    for each row execute function actors_cleanup_after_project_delete_fn();

create function actors_cleanup_after_workspace_delete_fn() returns trigger language plpgsql as $$
begin
    DELETE FROM actors WHERE workspace_id = OLD.id;
    return null;
end
$$;
create trigger actors_cleanup_after_workspace_delete after delete on "workspaces"
    for each row execute function actors_cleanup_after_workspace_delete_fn();

create function channel_profile_versions_archived_insert_fn() returns trigger language plpgsql as $$
begin
    if EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'workspace' AND resource_id = NEW.workspace_id AND state <> 'active') then
        raise exception 'resource_read_only';
    end if;
    return new;
end
$$;
create trigger channel_profile_versions_archived_insert before insert on "channel_profile_versions"
    for each row execute function channel_profile_versions_archived_insert_fn();

create function channel_profile_versions_archived_update_fn() returns trigger language plpgsql as $$
begin
    if EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'workspace' AND resource_id = NEW.workspace_id AND state <> 'active') then
        raise exception 'resource_read_only';
    end if;
    return new;
end
$$;
create trigger channel_profile_versions_archived_update before update on "channel_profile_versions"
    for each row execute function channel_profile_versions_archived_update_fn();

create function channels_archived_insert_fn() returns trigger language plpgsql as $$
begin
    if EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'workspace' AND resource_id = NEW.workspace_id AND state <> 'active') then
        raise exception 'resource_read_only';
    end if;
    return new;
end
$$;
create trigger channels_archived_insert before insert on "channels"
    for each row execute function channels_archived_insert_fn();

create function channels_archived_update_fn() returns trigger language plpgsql as $$
begin
    if EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'workspace' AND resource_id = NEW.workspace_id AND state <> 'active') then
        raise exception 'resource_read_only';
    end if;
    return new;
end
$$;
create trigger channels_archived_update before update on "channels"
    for each row execute function channels_archived_update_fn();

create function jobs_lifecycle_admission_fn() returns trigger language plpgsql as $$
begin
    if NEW.state = 'running' AND OLD.state <> 'running' AND EXISTS (
 SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active'
) then
        SELECT RAISE(IGNORE);
    end if;
    return new;
end
$$;
create trigger jobs_lifecycle_admission before update of state on "jobs"
    for each row execute function jobs_lifecycle_admission_fn();

create function media_assets_retirement_insert_fn() returns trigger language plpgsql as $$
begin
    if EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active') then
        raise exception 'resource_read_only';
    end if;
    return new;
end
$$;
create trigger media_assets_retirement_insert before insert on "media_assets"
    for each row execute function media_assets_retirement_insert_fn();

create function media_representations_retirement_insert_fn() returns trigger language plpgsql as $$
begin
    if EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active') then
        raise exception 'resource_read_only';
    end if;
    return new;
end
$$;
create trigger media_representations_retirement_insert before insert on "media_representations"
    for each row execute function media_representations_retirement_insert_fn();

create function media_upload_intents_retirement_insert_fn() returns trigger language plpgsql as $$
begin
    if EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active') then
        raise exception 'resource_read_only';
    end if;
    return new;
end
$$;
create trigger media_upload_intents_retirement_insert before insert on "media_upload_intents"
    for each row execute function media_upload_intents_retirement_insert_fn();

create function notification_deliveries_lifecycle_admission_fn() returns trigger language plpgsql as $$
begin
    if NEW.state = 'running' AND OLD.state <> 'running' AND EXISTS (
 SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active'
) then
        SELECT RAISE(IGNORE);
    end if;
    return new;
end
$$;
create trigger notification_deliveries_lifecycle_admission before update of state on "notification_deliveries"
    for each row execute function notification_deliveries_lifecycle_admission_fn();

create function notification_deliveries_retirement_insert_fn() returns trigger language plpgsql as $$
begin
    if EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active') then
        SELECT RAISE(IGNORE);
    end if;
    return new;
end
$$;
create trigger notification_deliveries_retirement_insert before insert on "notification_deliveries"
    for each row execute function notification_deliveries_retirement_insert_fn();

create function posts_archived_insert_fn() returns trigger language plpgsql as $$
begin
    if EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active') then
        raise exception 'resource_read_only';
    end if;
    return new;
end
$$;
create trigger posts_archived_insert before insert on "posts"
    for each row execute function posts_archived_insert_fn();

create function posts_archived_update_fn() returns trigger language plpgsql as $$
begin
    if EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active') then
        raise exception 'resource_read_only';
    end if;
    return new;
end
$$;
create trigger posts_archived_update before update on "posts"
    for each row execute function posts_archived_update_fn();

create function project_channel_profiles_on_attachment_fn() returns trigger language plpgsql as $$
begin
    INSERT INTO project_channel_profiles SELECT NEW.project_id,NEW.channel_id,p.id FROM channel_profile_versions p WHERE p.channel_id=NEW.channel_id AND NEW.state='active';
    return null;
end
$$;
create trigger project_channel_profiles_on_attachment after insert on "project_channel_attachments"
    for each row execute function project_channel_profiles_on_attachment_fn();

create function project_channel_profiles_on_reattach_fn() returns trigger language plpgsql as $$
begin
    if NEW.state='active' AND OLD.state='detached' then
        INSERT INTO project_channel_profiles SELECT NEW.project_id,NEW.channel_id,p.id FROM channel_profile_versions p WHERE p.channel_id=NEW.channel_id AND NOT EXISTS(SELECT 1 FROM project_channel_profiles b WHERE b.project_id=NEW.project_id AND b.profile_id=p.id);
    end if;
    return null;
end
$$;
create trigger project_channel_profiles_on_reattach after update of state on "project_channel_attachments"
    for each row execute function project_channel_profiles_on_reattach_fn();

create function project_channel_profiles_on_resource_fn() returns trigger language plpgsql as $$
begin
    INSERT INTO project_channel_profiles SELECT a.project_id,a.channel_id,NEW.id FROM project_channel_attachments a WHERE a.channel_id=NEW.channel_id AND a.state='active';
    return null;
end
$$;
create trigger project_channel_profiles_on_resource after insert on "channel_profile_versions"
    for each row execute function project_channel_profiles_on_resource_fn();

create function project_channel_publishers_on_attachment_fn() returns trigger language plpgsql as $$
begin
    INSERT INTO project_channel_publishers SELECT NEW.project_id,NEW.channel_id,p.id FROM publishers p WHERE p.channel_id=NEW.channel_id AND NEW.state='active';
    return null;
end
$$;
create trigger project_channel_publishers_on_attachment after insert on "project_channel_attachments"
    for each row execute function project_channel_publishers_on_attachment_fn();

create function project_channel_publishers_on_reattach_fn() returns trigger language plpgsql as $$
begin
    if NEW.state='active' AND OLD.state='detached' then
        INSERT INTO project_channel_publishers SELECT NEW.project_id,NEW.channel_id,p.id FROM publishers p WHERE p.channel_id=NEW.channel_id AND NOT EXISTS(SELECT 1 FROM project_channel_publishers b WHERE b.project_id=NEW.project_id AND b.publisher_id=p.id);
    end if;
    return null;
end
$$;
create trigger project_channel_publishers_on_reattach after update of state on "project_channel_attachments"
    for each row execute function project_channel_publishers_on_reattach_fn();

create function project_channel_publishers_on_resource_fn() returns trigger language plpgsql as $$
begin
    INSERT INTO project_channel_publishers SELECT a.project_id,a.channel_id,NEW.id FROM project_channel_attachments a WHERE a.channel_id=NEW.channel_id AND a.state='active';
    return null;
end
$$;
create trigger project_channel_publishers_on_resource after insert on "publishers"
    for each row execute function project_channel_publishers_on_resource_fn();

create function projects_lifecycle_identity_fn() returns trigger language plpgsql as $$
begin
    if EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.id) then
        raise exception 'resource_identity_reserved';
    end if;
    return new;
end
$$;
create trigger projects_lifecycle_identity before insert on "projects"
    for each row execute function projects_lifecycle_identity_fn();

create function publication_comment_replies_archived_insert_fn() returns trigger language plpgsql as $$
begin
    if EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active') then
        raise exception 'resource_read_only';
    end if;
    return new;
end
$$;
create trigger publication_comment_replies_archived_insert before insert on "publication_comment_replies"
    for each row execute function publication_comment_replies_archived_insert_fn();

create function publication_comment_replies_archived_update_fn() returns trigger language plpgsql as $$
begin
    if OLD.state <> 'running' AND EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active') then
        raise exception 'resource_read_only';
    end if;
    return new;
end
$$;
create trigger publication_comment_replies_archived_update before update on "publication_comment_replies"
    for each row execute function publication_comment_replies_archived_update_fn();

create function publication_comment_replies_lifecycle_admission_fn() returns trigger language plpgsql as $$
begin
    if NEW.state = 'running' AND OLD.state <> 'running' AND EXISTS (
 SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active'
) then
        SELECT RAISE(IGNORE);
    end if;
    return new;
end
$$;
create trigger publication_comment_replies_lifecycle_admission before update of state on "publication_comment_replies"
    for each row execute function publication_comment_replies_lifecycle_admission_fn();

create function publication_composer_drafts_archived_insert_fn() returns trigger language plpgsql as $$
begin
    if EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active') then
        raise exception 'resource_read_only';
    end if;
    return new;
end
$$;
create trigger publication_composer_drafts_archived_insert before insert on "publication_composer_drafts"
    for each row execute function publication_composer_drafts_archived_insert_fn();

create function publication_composer_drafts_archived_update_fn() returns trigger language plpgsql as $$
begin
    if EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active') then
        raise exception 'resource_read_only';
    end if;
    return new;
end
$$;
create trigger publication_composer_drafts_archived_update before update on "publication_composer_drafts"
    for each row execute function publication_composer_drafts_archived_update_fn();

create function publication_first_comments_lifecycle_admission_fn() returns trigger language plpgsql as $$
begin
    if NEW.state = 'running' AND OLD.state <> 'running' AND EXISTS (
 SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active'
) then
        SELECT RAISE(IGNORE);
    end if;
    return new;
end
$$;
create trigger publication_first_comments_lifecycle_admission before update of state on "publication_first_comments"
    for each row execute function publication_first_comments_lifecycle_admission_fn();

create function publication_first_comments_retirement_insert_fn() returns trigger language plpgsql as $$
begin
    if EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active') then
        raise exception 'resource_read_only';
    end if;
    return new;
end
$$;
create trigger publication_first_comments_retirement_insert before insert on "publication_first_comments"
    for each row execute function publication_first_comments_retirement_insert_fn();

create function publication_moves_immutable_fn() returns trigger language plpgsql as $$
begin
    raise exception 'Publication move history is immutable';
    return new;
end
$$;
create trigger publication_moves_immutable before update on "publication_moves"
    for each row execute function publication_moves_immutable_fn();

create function publication_moves_same_post_fn() returns trigger language plpgsql as $$
begin
    if (SELECT post_id FROM publications WHERE project_id=NEW.project_id AND id=NEW.source_publication_id)
    IS DISTINCT FROM (SELECT post_id FROM publications WHERE project_id=NEW.project_id AND id=NEW.destination_publication_id) then
        raise exception 'A publication move must retain its source post';
    end if;
    return new;
end
$$;
create trigger publication_moves_same_post before insert on "publication_moves"
    for each row execute function publication_moves_same_post_fn();

create function publication_target_revisions_archived_insert_fn() returns trigger language plpgsql as $$
begin
    if EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active') then
        raise exception 'resource_read_only';
    end if;
    return new;
end
$$;
create trigger publication_target_revisions_archived_insert before insert on "publication_target_revisions"
    for each row execute function publication_target_revisions_archived_insert_fn();

create function publication_target_revisions_archived_update_fn() returns trigger language plpgsql as $$
begin
    if EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active') then
        raise exception 'resource_read_only';
    end if;
    return new;
end
$$;
create trigger publication_target_revisions_archived_update before update on "publication_target_revisions"
    for each row execute function publication_target_revisions_archived_update_fn();

create function publication_working_drafts_archived_insert_fn() returns trigger language plpgsql as $$
begin
    if EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active') then
        raise exception 'resource_read_only';
    end if;
    return new;
end
$$;
create trigger publication_working_drafts_archived_insert before insert on "publication_working_drafts"
    for each row execute function publication_working_drafts_archived_insert_fn();

create function publication_working_drafts_archived_update_fn() returns trigger language plpgsql as $$
begin
    if EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active') then
        raise exception 'resource_read_only';
    end if;
    return new;
end
$$;
create trigger publication_working_drafts_archived_update before update on "publication_working_drafts"
    for each row execute function publication_working_drafts_archived_update_fn();

create function publications_retirement_insert_fn() returns trigger language plpgsql as $$
begin
    if NEW.state IN ('draft', 'scheduled', 'ready') AND EXISTS (
 SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active'
) then
        raise exception 'resource_read_only';
    end if;
    return new;
end
$$;
create trigger publications_retirement_insert before insert on "publications"
    for each row execute function publications_retirement_insert_fn();

create function publications_retirement_update_fn() returns trigger language plpgsql as $$
begin
    if OLD.state <> 'publishing' AND NEW.state IN ('draft', 'scheduled', 'ready') AND EXISTS (
 SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active'
) then
        raise exception 'resource_read_only';
    end if;
    return new;
end
$$;
create trigger publications_retirement_update before update on "publications"
    for each row execute function publications_retirement_update_fn();

create function publisher_connections_retirement_insert_fn() returns trigger language plpgsql as $$
begin
    if EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'workspace' AND resource_id = NEW.workspace_id AND state <> 'active') then
        raise exception 'resource_read_only';
    end if;
    return new;
end
$$;
create trigger publisher_connections_retirement_insert before insert on "publisher_connections"
    for each row execute function publisher_connections_retirement_insert_fn();

create function publishers_retirement_insert_fn() returns trigger language plpgsql as $$
begin
    if EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'workspace' AND resource_id = NEW.workspace_id AND state <> 'active') then
        raise exception 'resource_read_only';
    end if;
    return new;
end
$$;
create trigger publishers_retirement_insert before insert on "publishers"
    for each row execute function publishers_retirement_insert_fn();

create function shared_channel_attachment_identity_immutable_fn() returns trigger language plpgsql as $$
begin
    if NEW.project_id<>OLD.project_id OR NEW.channel_id<>OLD.channel_id OR NEW.workspace_id<>OLD.workspace_id then
        raise exception 'attachment_identity_immutable';
    end if;
    return new;
end
$$;
create trigger shared_channel_attachment_identity_immutable before update of project_id,channel_id,workspace_id on "project_channel_attachments"
    for each row execute function shared_channel_attachment_identity_immutable_fn();

create function shared_channels_cleanup_project_attachments_fn() returns trigger language plpgsql as $$
begin
    DELETE FROM project_channel_attachments WHERE project_id=OLD.id;
    return null;
end
$$;
create trigger shared_channels_cleanup_project_attachments after delete on "projects"
    for each row execute function shared_channels_cleanup_project_attachments_fn();

create function shared_channels_detach_manager_fn() returns trigger language plpgsql as $$
begin
    if NEW.state='detached' then
        DELETE FROM channel_managers WHERE project_id=NEW.project_id AND channel_id=NEW.channel_id;
    end if;
    return null;
end
$$;
create trigger shared_channels_detach_manager after update of state on "project_channel_attachments"
    for each row execute function shared_channels_detach_manager_fn();

create function shared_channels_jobs_effect_admission_fn() returns trigger language plpgsql as $$
begin
    if OLD.effect_started_at IS NULL AND NEW.effect_started_at IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM publications p JOIN project_channel_attachments a ON a.project_id=p.project_id AND a.channel_id=p.channel_id
 WHERE p.project_id=NEW.project_id AND p.id=NEW.publication_id AND a.state='active'
) then
        SELECT RAISE(IGNORE);
    end if;
    return new;
end
$$;
create trigger shared_channels_jobs_effect_admission before update of effect_started_at on "jobs"
    for each row execute function shared_channels_jobs_effect_admission_fn();

create function shared_channels_manager_insert_fn() returns trigger language plpgsql as $$
begin
    if NOT EXISTS(SELECT 1 FROM project_channel_attachments a WHERE a.project_id=NEW.project_id AND a.channel_id=NEW.channel_id AND a.state='active') then
        raise exception 'manager_requires_active_attachment';
    end if;
    return new;
end
$$;
create trigger shared_channels_manager_insert before insert on "channel_managers"
    for each row execute function shared_channels_manager_insert_fn();

create function shared_channels_manager_update_fn() returns trigger language plpgsql as $$
begin
    if NOT EXISTS(SELECT 1 FROM project_channel_attachments a WHERE a.project_id=NEW.project_id AND a.channel_id=NEW.channel_id AND a.state='active') then
        raise exception 'manager_requires_active_attachment';
    end if;
    return new;
end
$$;
create trigger shared_channels_manager_update before update on "channel_managers"
    for each row execute function shared_channels_manager_update_fn();

create function shared_channels_publication_admission_fn() returns trigger language plpgsql as $$
begin
    if NOT EXISTS (SELECT 1 FROM project_channel_attachments a WHERE a.project_id=NEW.project_id AND a.channel_id=NEW.channel_id AND a.state='active') then
        raise exception 'channel_detached';
    end if;
    return new;
end
$$;
create trigger shared_channels_publication_admission before insert on "publications"
    for each row execute function shared_channels_publication_admission_fn();

create function shared_channels_publication_comment_replies_effect_admission_fn() returns trigger language plpgsql as $$
begin
    if OLD.effect_started_at IS NULL AND NEW.effect_started_at IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM publications p JOIN project_channel_attachments a ON a.project_id=p.project_id AND a.channel_id=p.channel_id
 WHERE p.project_id=NEW.project_id AND p.id=NEW.publication_id AND a.state='active'
) then
        SELECT RAISE(IGNORE);
    end if;
    return new;
end
$$;
create trigger shared_channels_publication_comment_replies_effect_admission before update of effect_started_at on "publication_comment_replies"
    for each row execute function shared_channels_publication_comment_replies_effect_admission_fn();

create function shared_channels_publication_first_comments_effect_admission_fn() returns trigger language plpgsql as $$
begin
    if OLD.effect_started_at IS NULL AND NEW.effect_started_at IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM publications p JOIN project_channel_attachments a ON a.project_id=p.project_id AND a.channel_id=p.channel_id
 WHERE p.project_id=NEW.project_id AND p.id=NEW.publication_id AND a.state='active'
) then
        SELECT RAISE(IGNORE);
    end if;
    return new;
end
$$;
create trigger shared_channels_publication_first_comments_effect_admission before update of effect_started_at on "publication_first_comments"
    for each row execute function shared_channels_publication_first_comments_effect_admission_fn();

create function workspaces_lifecycle_identity_fn() returns trigger language plpgsql as $$
begin
    if EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'workspace' AND resource_id = NEW.id) then
        raise exception 'resource_identity_reserved';
    end if;
    return new;
end
$$;
create trigger workspaces_lifecycle_identity before insert on "workspaces"
    for each row execute function workspaces_lifecycle_identity_fn();

-- postdot:common
insert into "instance_state" ("id", "state", "bootstrap_blocked", "created_at", "updated_at")
values ('default', 'claimable', 0, cast(unixepoch('subsecond') * 1000 as bigint), cast(unixepoch('subsecond') * 1000 as bigint));

-- postdot:postgres
-- Scope cleanup triggers remove actors and project attachments after the
-- owning scope's dependent rows have cascaded (SQLite checks NO ACTION keys at
-- statement end, after triggers). PostgreSQL fires its key checks and these
-- AFTER triggers in name order, so these keys are checked at commit instead.
alter table "actors" alter constraint "actors_project_id_fkey" deferrable initially deferred;
alter table "actors" alter constraint "actors_workspace_id_fkey" deferrable initially deferred;
alter table "project_channel_attachments" alter constraint "project_channel_attachments_workspace_id_project_id_fkey" deferrable initially deferred;
