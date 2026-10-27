-- Candidate only: not part of the startup migration journal.
-- Unknown ownership must be resolved explicitly; never assign a default.
CREATE TABLE __share_ownership_guard (valid integer CONSTRAINT workspace_assignment_required CHECK (valid = 1));
--> statement-breakpoint
INSERT INTO __share_ownership_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM projects p LEFT JOIN workspaces w ON w.id=p.workspace_id WHERE w.id IS NULL) THEN 0 ELSE 1 END;
--> statement-breakpoint
DROP VIEW project_channel_contexts;
--> statement-breakpoint
DROP VIEW project_channel_profile_contexts;
--> statement-breakpoint
DROP VIEW project_publisher_contexts;
--> statement-breakpoint
DROP VIEW project_publisher_connection_contexts;
--> statement-breakpoint
DROP VIEW project_publisher_credential_contexts;
--> statement-breakpoint
DROP TRIGGER jobs_lifecycle_admission;
--> statement-breakpoint
DROP TRIGGER publication_comment_replies_lifecycle_admission;
--> statement-breakpoint
DROP TRIGGER publication_first_comments_lifecycle_admission;
--> statement-breakpoint
DROP TRIGGER notification_deliveries_lifecycle_admission;
--> statement-breakpoint
DROP TRIGGER posts_archived_insert;
--> statement-breakpoint
DROP TRIGGER posts_archived_update;
--> statement-breakpoint
DROP TRIGGER publication_composer_drafts_archived_insert;
--> statement-breakpoint
DROP TRIGGER publication_composer_drafts_archived_update;
--> statement-breakpoint
DROP TRIGGER channels_archived_insert;
--> statement-breakpoint
DROP TRIGGER channels_archived_update;
--> statement-breakpoint
DROP TRIGGER channel_profile_versions_archived_insert;
--> statement-breakpoint
DROP TRIGGER channel_profile_versions_archived_update;
--> statement-breakpoint
DROP TRIGGER publication_working_drafts_archived_insert;
--> statement-breakpoint
DROP TRIGGER publication_working_drafts_archived_update;
--> statement-breakpoint
DROP TRIGGER publication_target_revisions_archived_insert;
--> statement-breakpoint
DROP TRIGGER publication_target_revisions_archived_update;
--> statement-breakpoint
DROP TRIGGER publication_comment_replies_archived_insert;
--> statement-breakpoint
DROP TRIGGER publication_comment_replies_archived_update;
--> statement-breakpoint
DROP TRIGGER publications_retirement_insert;
--> statement-breakpoint
DROP TRIGGER publications_retirement_update;
--> statement-breakpoint
DROP TRIGGER projects_lifecycle_identity;
--> statement-breakpoint
DROP TRIGGER workspaces_lifecycle_identity;
--> statement-breakpoint
DROP TRIGGER media_assets_retirement_insert;
--> statement-breakpoint
DROP TRIGGER media_representations_retirement_insert;
--> statement-breakpoint
DROP TRIGGER media_upload_intents_retirement_insert;
--> statement-breakpoint
DROP TRIGGER publisher_connections_retirement_insert;
--> statement-breakpoint
DROP TRIGGER publishers_retirement_insert;
--> statement-breakpoint
DROP TRIGGER publication_first_comments_retirement_insert;
--> statement-breakpoint
DROP TRIGGER notification_deliveries_retirement_insert;
--> statement-breakpoint
DROP TRIGGER actors_cleanup_after_project_delete;
--> statement-breakpoint
DROP TRIGGER actors_cleanup_after_workspace_delete;
--> statement-breakpoint
CREATE TABLE __share_managers AS SELECT id AS channel_id, project_id FROM channels;
--> statement-breakpoint
CREATE TABLE __share_migration_time (at integer NOT NULL);
--> statement-breakpoint
INSERT INTO __share_migration_time VALUES (cast(unixepoch('subsecond') * 1000 as integer));
--> statement-breakpoint
CREATE TABLE __share_actor_map (project_id text NOT NULL, origin_actor_id text NOT NULL, workspace_id text NOT NULL, actor_id text NOT NULL, PRIMARY KEY(project_id,origin_actor_id));
--> statement-breakpoint
INSERT INTO __share_actor_map SELECT refs.project_id, refs.actor_id, p.workspace_id, coalesce(a.id, lower(hex(randomblob(16)))) FROM (
 SELECT project_id,created_by_actor_id AS actor_id FROM channel_profile_versions
 UNION SELECT project_id,connected_by_actor_id FROM publisher_credentials
 UNION SELECT project_id,connected_by_actor_id FROM publisher_connections
) refs JOIN projects p ON p.id=refs.project_id LEFT JOIN actors a ON a.workspace_id=p.workspace_id AND a.origin_actor_id=refs.actor_id;
--> statement-breakpoint
INSERT INTO actors (id,workspace_id,origin_actor_id,kind,subject_id,display_name,created_at,updated_at)
 SELECT m.actor_id,m.workspace_id,m.origin_actor_id,a.kind,a.subject_id,a.display_name,t.at,t.at
 FROM __share_actor_map m JOIN actors a ON a.id=m.origin_actor_id CROSS JOIN __share_migration_time t
 WHERE NOT EXISTS (SELECT 1 FROM actors existing WHERE existing.id=m.actor_id);
--> statement-breakpoint
CREATE UNIQUE INDEX projects_workspace_id_id_uidx ON projects(workspace_id,id);
--> statement-breakpoint
CREATE TABLE __new_channels (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`profile_version_id` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`archived_at` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, `destination_revision` integer DEFAULT 0 NOT NULL, `destination_identity_json` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "channels_profile_version_id_nonblank" CHECK(length(trim("__new_channels"."profile_version_id")) > 0),
	CONSTRAINT "channels_name_nonblank" CHECK(length(trim("__new_channels"."name")) > 0),
	CONSTRAINT "channels_state_valid" CHECK("__new_channels"."state" in ('active', 'archived')),
	CONSTRAINT "channels_archived_timestamp_valid" CHECK(("__new_channels"."state" = 'active' and "__new_channels"."archived_at" is null)
                or ("__new_channels"."state" = 'archived' and "__new_channels"."archived_at" is not null)),
	CONSTRAINT "channels_revision_positive" CHECK("__new_channels"."revision" > 0)
);
--> statement-breakpoint
INSERT INTO __new_channels (id,workspace_id,name,profile_version_id,state,archived_at,revision,created_at,updated_at,destination_revision,destination_identity_json) SELECT old.id,(SELECT workspace_id FROM projects WHERE id=old.project_id),old.name,old.profile_version_id,old.state,old.archived_at,old.revision,old.created_at,old.updated_at,old.destination_revision,old.destination_identity_json FROM channels old;
--> statement-breakpoint
DROP TABLE channels;
--> statement-breakpoint
ALTER TABLE __new_channels RENAME TO channels;
--> statement-breakpoint
CREATE UNIQUE INDEX `channels_workspace_id_id_uidx` ON `channels` (`workspace_id`,`id`);
--> statement-breakpoint
CREATE TABLE __new_channel_profile_versions (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`version` integer NOT NULL,
	`origin` text NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`profile_json` text NOT NULL,
	`profile_hash` text NOT NULL,
	`schema_hash` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`channel_id`) REFERENCES `channels`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`created_by_actor_id`) REFERENCES `actors`(`workspace_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "channel_profile_versions_profile_id_nonblank" CHECK(length(trim("__new_channel_profile_versions"."profile_id")) > 0),
	CONSTRAINT "channel_profile_versions_version_positive" CHECK("__new_channel_profile_versions"."version" > 0),
	CONSTRAINT "channel_profile_versions_revision_positive" CHECK("__new_channel_profile_versions"."revision" > 0),
	CONSTRAINT "channel_profile_versions_profile_json_object" CHECK(json_valid("__new_channel_profile_versions"."profile_json") and json_type("__new_channel_profile_versions"."profile_json") = 'object'),
	CONSTRAINT "channel_profile_versions_hashes_nonblank" CHECK(length(trim("__new_channel_profile_versions"."profile_hash")) > 0 and length(trim("__new_channel_profile_versions"."schema_hash")) > 0),
	CONSTRAINT "channel_profile_versions_origin_valid" CHECK("__new_channel_profile_versions"."origin" in ('built_in', 'custom')),
	CONSTRAINT "channel_profile_versions_state_valid" CHECK("__new_channel_profile_versions"."state" in ('draft', 'active', 'superseded', 'disabled'))
);
--> statement-breakpoint
INSERT INTO __new_channel_profile_versions (id,workspace_id,channel_id,profile_id,version,origin,state,revision,profile_json,profile_hash,schema_hash,created_by_actor_id,created_at,updated_at) SELECT old.id,(SELECT workspace_id FROM projects WHERE id=old.project_id),old.channel_id,old.profile_id,old.version,old.origin,old.state,old.revision,old.profile_json,old.profile_hash,old.schema_hash,(SELECT actor_id FROM __share_actor_map WHERE project_id=old.project_id AND origin_actor_id=old.created_by_actor_id),old.created_at,old.updated_at FROM channel_profile_versions old;
--> statement-breakpoint
DROP TABLE channel_profile_versions;
--> statement-breakpoint
ALTER TABLE __new_channel_profile_versions RENAME TO channel_profile_versions;
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_profile_versions_workspace_id_id_uidx` ON `channel_profile_versions` (`workspace_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_profile_versions_workspace_channel_version_uidx` ON `channel_profile_versions` (`workspace_id`,`channel_id`,`version`);
--> statement-breakpoint
CREATE INDEX `channel_profile_versions_workspace_channel_state_idx` ON `channel_profile_versions` (`workspace_id`,`channel_id`,`state`);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_profile_versions_workspace_channel_active_uidx` ON `channel_profile_versions` (`workspace_id`,`channel_id`) WHERE "channel_profile_versions"."state" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_profile_versions_workspace_channel_draft_uidx` ON `channel_profile_versions` (`workspace_id`,`channel_id`) WHERE "channel_profile_versions"."state" = 'draft';
--> statement-breakpoint
CREATE TABLE __new_publishers (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`channel_id`) REFERENCES `channels`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "publishers_kind_nonblank" CHECK(length(trim("__new_publishers"."kind")) > 0)
);
--> statement-breakpoint
INSERT INTO __new_publishers (id,workspace_id,channel_id,kind,created_at,updated_at) SELECT old.id,(SELECT workspace_id FROM projects WHERE id=old.project_id),old.channel_id,old.kind,old.created_at,old.updated_at FROM publishers old;
--> statement-breakpoint
DROP TABLE publishers;
--> statement-breakpoint
ALTER TABLE __new_publishers RENAME TO publishers;
--> statement-breakpoint
CREATE UNIQUE INDEX `publishers_workspace_id_id_uidx` ON `publishers` (`workspace_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `publishers_workspace_id_channel_id_uidx` ON `publishers` (`workspace_id`,`channel_id`);
--> statement-breakpoint
CREATE TABLE __new_publisher_credentials (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`external_account_id` text NOT NULL,
	`external_account_name` text,
	`scopes` text NOT NULL,
	`state` text NOT NULL,
	`expires_at` integer,
	`connected_by_actor_id` text NOT NULL,
	`provider_application_id` text,
	`encryption_version` integer,
	`encryption_key_id` text,
	`access_token_ciphertext` blob,
	`access_token_nonce` blob,
	`refresh_token_ciphertext` blob,
	`refresh_token_nonce` blob,
	`provider_session_ciphertext` blob,
	`provider_session_nonce` blob,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`connected_by_actor_id`) REFERENCES `actors`(`workspace_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`provider_id`,`provider_application_id`) REFERENCES `provider_application_configurations`(`provider_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publisher_credentials_provider_nonblank" CHECK(length(trim("__new_publisher_credentials"."provider_id")) > 0),
	CONSTRAINT "publisher_credentials_external_account_nonblank" CHECK(length(trim("__new_publisher_credentials"."external_account_id")) > 0),
	CONSTRAINT "publisher_credentials_external_name_nonblank" CHECK("__new_publisher_credentials"."external_account_name" is null or length(trim("__new_publisher_credentials"."external_account_name")) > 0),
	CONSTRAINT "publisher_credentials_scopes_json_array" CHECK(json_valid("__new_publisher_credentials"."scopes") and json_type("__new_publisher_credentials"."scopes") = 'array'),
	CONSTRAINT "publisher_credentials_state_valid" CHECK("__new_publisher_credentials"."state" in ('active', 'reconnect_required', 'revoked')),
	CONSTRAINT "publisher_credentials_expiry_valid" CHECK("__new_publisher_credentials"."expires_at" is null or "__new_publisher_credentials"."expires_at" >= 0),
	CONSTRAINT "publisher_credentials_encryption_version_valid" CHECK("__new_publisher_credentials"."encryption_version" is null or "__new_publisher_credentials"."encryption_version" > 0),
	CONSTRAINT "publisher_credentials_encryption_key_nonblank" CHECK("__new_publisher_credentials"."encryption_key_id" is null or length(trim("__new_publisher_credentials"."encryption_key_id")) > 0),
	CONSTRAINT "publisher_credentials_secret_state_valid" CHECK((
                    "__new_publisher_credentials"."state" in ('active', 'reconnect_required')
                    and "__new_publisher_credentials"."encryption_version" is not null
                    and "__new_publisher_credentials"."encryption_key_id" is not null
                    and "__new_publisher_credentials"."access_token_ciphertext" is not null
                    and "__new_publisher_credentials"."access_token_nonce" is not null
                    and length("__new_publisher_credentials"."access_token_ciphertext") > 16
                    and length("__new_publisher_credentials"."access_token_nonce") = 12
                ) or (
                    "__new_publisher_credentials"."state" = 'revoked'
                    and "__new_publisher_credentials"."encryption_version" is null
                    and "__new_publisher_credentials"."encryption_key_id" is null
                    and "__new_publisher_credentials"."access_token_ciphertext" is null
                    and "__new_publisher_credentials"."access_token_nonce" is null
                    and "__new_publisher_credentials"."refresh_token_ciphertext" is null
                    and "__new_publisher_credentials"."refresh_token_nonce" is null
                    and "__new_publisher_credentials"."provider_session_ciphertext" is null
                    and "__new_publisher_credentials"."provider_session_nonce" is null
                )),
	CONSTRAINT "publisher_credentials_refresh_token_envelope_valid" CHECK(("__new_publisher_credentials"."refresh_token_ciphertext" is null and "__new_publisher_credentials"."refresh_token_nonce" is null)
                or ("__new_publisher_credentials"."refresh_token_ciphertext" is not null
                    and "__new_publisher_credentials"."refresh_token_nonce" is not null
                    and length("__new_publisher_credentials"."refresh_token_ciphertext") > 16
                    and length("__new_publisher_credentials"."refresh_token_nonce") = 12)),
	CONSTRAINT "publisher_credentials_provider_session_envelope_valid" CHECK(("__new_publisher_credentials"."provider_session_ciphertext" is null and "__new_publisher_credentials"."provider_session_nonce" is null)
                or ("__new_publisher_credentials"."provider_session_ciphertext" is not null
                    and "__new_publisher_credentials"."provider_session_nonce" is not null
                    and length("__new_publisher_credentials"."provider_session_ciphertext") > 16
                    and length("__new_publisher_credentials"."provider_session_nonce") = 12)),
	CONSTRAINT "publisher_credentials_revision_valid" CHECK("__new_publisher_credentials"."revision" > 0)
);
--> statement-breakpoint
INSERT INTO __new_publisher_credentials (id,workspace_id,provider_id,external_account_id,external_account_name,scopes,state,expires_at,connected_by_actor_id,provider_application_id,encryption_version,encryption_key_id,access_token_ciphertext,access_token_nonce,refresh_token_ciphertext,refresh_token_nonce,provider_session_ciphertext,provider_session_nonce,revision,created_at,updated_at) SELECT old.id,(SELECT workspace_id FROM projects WHERE id=old.project_id),old.provider_id,old.external_account_id,old.external_account_name,old.scopes,old.state,old.expires_at,(SELECT actor_id FROM __share_actor_map WHERE project_id=old.project_id AND origin_actor_id=old.connected_by_actor_id),old.provider_application_id,old.encryption_version,old.encryption_key_id,old.access_token_ciphertext,old.access_token_nonce,old.refresh_token_ciphertext,old.refresh_token_nonce,old.provider_session_ciphertext,old.provider_session_nonce,old.revision,old.created_at,old.updated_at FROM publisher_credentials old;
--> statement-breakpoint
DROP TABLE publisher_credentials;
--> statement-breakpoint
ALTER TABLE __new_publisher_credentials RENAME TO publisher_credentials;
--> statement-breakpoint
CREATE UNIQUE INDEX `publisher_credentials_workspace_id_id_uidx` ON `publisher_credentials` (`workspace_id`,`id`);
--> statement-breakpoint
CREATE INDEX `publisher_credentials_workspace_state_expires_idx` ON `publisher_credentials` (`workspace_id`,`state`,`expires_at`);
--> statement-breakpoint
CREATE INDEX `publisher_credentials_workspace_actor_idx` ON `publisher_credentials` (`workspace_id`,`connected_by_actor_id`);
--> statement-breakpoint
CREATE TABLE __new_publisher_connections (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`publisher_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`endpoint_url` text,
	`authentication_json` text,
	`destination_type` text,
	`destination_id` text,
	`destination_name` text,
	`connected_by_actor_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`publisher_id`) REFERENCES `publishers`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`credential_id`) REFERENCES `publisher_credentials`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`connected_by_actor_id`) REFERENCES `actors`(`workspace_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publisher_connections_endpoint_url_nonblank" CHECK("__new_publisher_connections"."endpoint_url" is null or length(trim("__new_publisher_connections"."endpoint_url")) > 0),
	CONSTRAINT "publisher_connections_authentication_json_object" CHECK("__new_publisher_connections"."authentication_json" is null or (json_valid("__new_publisher_connections"."authentication_json") and json_type("__new_publisher_connections"."authentication_json") = 'object')),
	CONSTRAINT "publisher_connections_destination_pair_valid" CHECK((
                ("__new_publisher_connections"."destination_type" is null and "__new_publisher_connections"."destination_id" is null and "__new_publisher_connections"."destination_name" is null)
                or ("__new_publisher_connections"."destination_type" is not null
                    and length(trim("__new_publisher_connections"."destination_type")) > 0
                    and "__new_publisher_connections"."destination_id" is not null
                    and length(trim("__new_publisher_connections"."destination_id")) > 0
                    and ("__new_publisher_connections"."destination_name" is null or length(trim("__new_publisher_connections"."destination_name")) > 0))
            ))
);
--> statement-breakpoint
INSERT INTO __new_publisher_connections (id,workspace_id,publisher_id,credential_id,endpoint_url,authentication_json,destination_type,destination_id,destination_name,connected_by_actor_id,created_at,updated_at) SELECT old.id,(SELECT workspace_id FROM projects WHERE id=old.project_id),old.publisher_id,old.credential_id,old.endpoint_url,old.authentication_json,old.destination_type,old.destination_id,old.destination_name,(SELECT actor_id FROM __share_actor_map WHERE project_id=old.project_id AND origin_actor_id=old.connected_by_actor_id),old.created_at,old.updated_at FROM publisher_connections old;
--> statement-breakpoint
DROP TABLE publisher_connections;
--> statement-breakpoint
ALTER TABLE __new_publisher_connections RENAME TO publisher_connections;
--> statement-breakpoint
CREATE UNIQUE INDEX `publisher_connections_workspace_id_publisher_id_uidx` ON `publisher_connections` (`workspace_id`,`publisher_id`);
--> statement-breakpoint
CREATE INDEX `publisher_connections_credential_id_idx` ON `publisher_connections` (`credential_id`);
--> statement-breakpoint
CREATE INDEX `publisher_connections_workspace_id_actor_id_idx` ON `publisher_connections` (`workspace_id`,`connected_by_actor_id`);
--> statement-breakpoint
CREATE TABLE channel_managers (channel_id text PRIMARY KEY NOT NULL, project_id text NOT NULL, workspace_id text NOT NULL,
 FOREIGN KEY(project_id,channel_id) REFERENCES project_channel_attachments(project_id,channel_id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,channel_id) REFERENCES channels(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id) ON DELETE CASCADE);
--> statement-breakpoint
INSERT INTO channel_managers SELECT m.channel_id,m.project_id,c.workspace_id FROM __share_managers m JOIN channels c ON c.id=m.channel_id;
--> statement-breakpoint
CREATE UNIQUE INDEX channel_profiles_channel_id_id_uidx ON channel_profile_versions(channel_id,id);
--> statement-breakpoint
CREATE UNIQUE INDEX publishers_channel_id_id_uidx ON publishers(channel_id,id);
--> statement-breakpoint
CREATE TABLE project_channel_attachments (
 project_id text NOT NULL, channel_id text NOT NULL, workspace_id text NOT NULL,
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','detached')),
 origin text NOT NULL CHECK(origin IN ('migrated','explicit')),
 attached_by_actor_id text, attached_at integer NOT NULL, detached_at integer,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 PRIMARY KEY(project_id,channel_id),
 FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id) ON DELETE NO ACTION,
 FOREIGN KEY(workspace_id,channel_id) REFERENCES channels(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,attached_by_actor_id) REFERENCES actors(workspace_id,id) ON DELETE RESTRICT,
 CHECK((state='active' AND detached_at IS NULL) OR (state='detached' AND detached_at IS NOT NULL)),
 CHECK((origin='migrated' AND attached_by_actor_id IS NULL) OR (origin='explicit' AND attached_by_actor_id IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO project_channel_attachments(project_id,channel_id,workspace_id,origin,attached_at)
 SELECT m.project_id,c.id,c.workspace_id,'migrated',t.at FROM channels c JOIN __share_managers m ON m.channel_id=c.id CROSS JOIN __share_migration_time t;
--> statement-breakpoint
CREATE TABLE project_channel_profiles (project_id text NOT NULL, channel_id text NOT NULL, profile_id text NOT NULL,
 PRIMARY KEY(project_id,profile_id),
 FOREIGN KEY(project_id,channel_id) REFERENCES project_channel_attachments(project_id,channel_id) ON DELETE CASCADE,
 FOREIGN KEY(channel_id,profile_id) REFERENCES channel_profile_versions(channel_id,id) ON DELETE CASCADE);
--> statement-breakpoint
INSERT INTO project_channel_profiles SELECT a.project_id,a.channel_id,p.id FROM project_channel_attachments a JOIN channel_profile_versions p ON p.channel_id=a.channel_id;
--> statement-breakpoint
CREATE TRIGGER project_channel_profiles_on_attachment AFTER INSERT ON project_channel_attachments BEGIN
 INSERT INTO project_channel_profiles SELECT NEW.project_id,NEW.channel_id,p.id FROM channel_profile_versions p WHERE p.channel_id=NEW.channel_id AND NEW.state='active'; END;
--> statement-breakpoint
CREATE TRIGGER project_channel_profiles_on_resource AFTER INSERT ON channel_profile_versions BEGIN
 INSERT INTO project_channel_profiles SELECT a.project_id,a.channel_id,NEW.id FROM project_channel_attachments a WHERE a.channel_id=NEW.channel_id AND a.state='active'; END;
--> statement-breakpoint
CREATE TABLE project_channel_publishers (project_id text NOT NULL, channel_id text NOT NULL, publisher_id text NOT NULL,
 PRIMARY KEY(project_id,publisher_id),
 FOREIGN KEY(project_id,channel_id) REFERENCES project_channel_attachments(project_id,channel_id) ON DELETE CASCADE,
 FOREIGN KEY(channel_id,publisher_id) REFERENCES publishers(channel_id,id) ON DELETE CASCADE);
--> statement-breakpoint
INSERT INTO project_channel_publishers SELECT a.project_id,a.channel_id,p.id FROM project_channel_attachments a JOIN publishers p ON p.channel_id=a.channel_id;
--> statement-breakpoint
CREATE TRIGGER project_channel_publishers_on_attachment AFTER INSERT ON project_channel_attachments BEGIN
 INSERT INTO project_channel_publishers SELECT NEW.project_id,NEW.channel_id,p.id FROM publishers p WHERE p.channel_id=NEW.channel_id AND NEW.state='active'; END;
--> statement-breakpoint
CREATE TRIGGER project_channel_publishers_on_resource AFTER INSERT ON publishers BEGIN
 INSERT INTO project_channel_publishers SELECT a.project_id,a.channel_id,NEW.id FROM project_channel_attachments a WHERE a.channel_id=NEW.channel_id AND a.state='active'; END;
--> statement-breakpoint
CREATE TABLE __new_oauth_authorization_attempts (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`connected_by_actor_id` text NOT NULL,
	`provider_application_id` text,
	`callback_uri` text NOT NULL,
	`scopes` text NOT NULL,
	`return_path` text NOT NULL,
	`context_json` text DEFAULT '{}' NOT NULL,
	`state_digest` blob NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`pkce_encryption_version` integer,
	`pkce_encryption_key_id` text,
	`pkce_verifier_ciphertext` blob,
	`pkce_verifier_nonce` blob,
	`provider_state_encryption_version` integer,
	`provider_state_encryption_key_id` text,
	`provider_state_ciphertext` blob,
	`provider_state_nonce` blob,
	`expires_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`channel_id`) REFERENCES project_channel_attachments(project_id,channel_id) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`connected_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`provider_id`,`provider_application_id`) REFERENCES `provider_application_configurations`(`provider_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "oauth_authorization_attempts_provider_nonblank" CHECK(length(trim("__new_oauth_authorization_attempts"."provider_id")) > 0),
	CONSTRAINT "oauth_authorization_attempts_callback_nonblank" CHECK(length(trim("__new_oauth_authorization_attempts"."callback_uri")) > 0),
	CONSTRAINT "oauth_authorization_attempts_return_path_local" CHECK(substr("__new_oauth_authorization_attempts"."return_path", 1, 1) = '/'
                and substr("__new_oauth_authorization_attempts"."return_path", 1, 2) != '//'
                and instr("__new_oauth_authorization_attempts"."return_path", char(92)) = 0),
	CONSTRAINT "oauth_authorization_attempts_scopes_json_array" CHECK(json_valid("__new_oauth_authorization_attempts"."scopes") and json_type("__new_oauth_authorization_attempts"."scopes") = 'array'),
	CONSTRAINT "oauth_authorization_attempts_context_json_object" CHECK(json_valid("__new_oauth_authorization_attempts"."context_json") and json_type("__new_oauth_authorization_attempts"."context_json") = 'object'),
	CONSTRAINT "oauth_authorization_attempts_state_digest_length" CHECK(length("__new_oauth_authorization_attempts"."state_digest") = 32),
	CONSTRAINT "oauth_authorization_attempts_status_valid" CHECK("__new_oauth_authorization_attempts"."status" in ('pending', 'consumed', 'expired')),
	CONSTRAINT "oauth_authorization_attempts_time_valid" CHECK("__new_oauth_authorization_attempts"."expires_at" > "__new_oauth_authorization_attempts"."created_at"
                and ("__new_oauth_authorization_attempts"."completed_at" is null or "__new_oauth_authorization_attempts"."completed_at" >= "__new_oauth_authorization_attempts"."created_at")),
	CONSTRAINT "oauth_authorization_attempts_secret_state_valid" CHECK((
                    "__new_oauth_authorization_attempts"."status" = 'pending'
                    and "__new_oauth_authorization_attempts"."completed_at" is null
                    and (
                        (
                            "__new_oauth_authorization_attempts"."pkce_encryption_version" is null
                            and "__new_oauth_authorization_attempts"."pkce_encryption_key_id" is null
                            and "__new_oauth_authorization_attempts"."pkce_verifier_ciphertext" is null
                            and "__new_oauth_authorization_attempts"."pkce_verifier_nonce" is null
                        ) or (
                            "__new_oauth_authorization_attempts"."pkce_encryption_version" is not null
                            and "__new_oauth_authorization_attempts"."pkce_encryption_version" > 0
                            and "__new_oauth_authorization_attempts"."pkce_encryption_key_id" is not null
                            and length(trim("__new_oauth_authorization_attempts"."pkce_encryption_key_id")) > 0
                            and "__new_oauth_authorization_attempts"."pkce_verifier_ciphertext" is not null
                            and length("__new_oauth_authorization_attempts"."pkce_verifier_ciphertext") > 16
                            and "__new_oauth_authorization_attempts"."pkce_verifier_nonce" is not null
                            and length("__new_oauth_authorization_attempts"."pkce_verifier_nonce") = 12
                        )
                    )
                    and (
                        (
                            "__new_oauth_authorization_attempts"."provider_state_encryption_version" is null
                            and "__new_oauth_authorization_attempts"."provider_state_encryption_key_id" is null
                            and "__new_oauth_authorization_attempts"."provider_state_ciphertext" is null
                            and "__new_oauth_authorization_attempts"."provider_state_nonce" is null
                        ) or (
                            "__new_oauth_authorization_attempts"."provider_state_encryption_version" is not null
                            and "__new_oauth_authorization_attempts"."provider_state_encryption_version" > 0
                            and "__new_oauth_authorization_attempts"."provider_state_encryption_key_id" is not null
                            and length(trim("__new_oauth_authorization_attempts"."provider_state_encryption_key_id")) > 0
                            and "__new_oauth_authorization_attempts"."provider_state_ciphertext" is not null
                            and length("__new_oauth_authorization_attempts"."provider_state_ciphertext") > 16
                            and "__new_oauth_authorization_attempts"."provider_state_nonce" is not null
                            and length("__new_oauth_authorization_attempts"."provider_state_nonce") = 12
                        )
                    )
                ) or (
                    "__new_oauth_authorization_attempts"."status" in ('consumed', 'expired')
                    and "__new_oauth_authorization_attempts"."completed_at" is not null
                    and "__new_oauth_authorization_attempts"."pkce_encryption_version" is null
                    and "__new_oauth_authorization_attempts"."pkce_encryption_key_id" is null
                    and "__new_oauth_authorization_attempts"."pkce_verifier_ciphertext" is null
                    and "__new_oauth_authorization_attempts"."pkce_verifier_nonce" is null
                    and "__new_oauth_authorization_attempts"."provider_state_encryption_version" is null
                    and "__new_oauth_authorization_attempts"."provider_state_encryption_key_id" is null
                    and "__new_oauth_authorization_attempts"."provider_state_ciphertext" is null
                    and "__new_oauth_authorization_attempts"."provider_state_nonce" is null
                ))
);
--> statement-breakpoint
INSERT INTO __new_oauth_authorization_attempts (id,project_id,channel_id,provider_id,connected_by_actor_id,provider_application_id,callback_uri,scopes,return_path,context_json,state_digest,status,pkce_encryption_version,pkce_encryption_key_id,pkce_verifier_ciphertext,pkce_verifier_nonce,provider_state_encryption_version,provider_state_encryption_key_id,provider_state_ciphertext,provider_state_nonce,expires_at,completed_at,created_at,updated_at) SELECT old.id,old.project_id,old.channel_id,old.provider_id,old.connected_by_actor_id,old.provider_application_id,old.callback_uri,old.scopes,old.return_path,old.context_json,old.state_digest,old.status,old.pkce_encryption_version,old.pkce_encryption_key_id,old.pkce_verifier_ciphertext,old.pkce_verifier_nonce,old.provider_state_encryption_version,old.provider_state_encryption_key_id,old.provider_state_ciphertext,old.provider_state_nonce,old.expires_at,old.completed_at,old.created_at,old.updated_at FROM oauth_authorization_attempts old;
--> statement-breakpoint
DROP TABLE oauth_authorization_attempts;
--> statement-breakpoint
ALTER TABLE __new_oauth_authorization_attempts RENAME TO oauth_authorization_attempts;
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_authorization_attempts_state_digest_uidx` ON `oauth_authorization_attempts` (`state_digest`);
--> statement-breakpoint
CREATE INDEX `oauth_authorization_attempts_project_channel_idx` ON `oauth_authorization_attempts` (`project_id`,`channel_id`);
--> statement-breakpoint
CREATE INDEX `oauth_authorization_attempts_status_expires_idx` ON `oauth_authorization_attempts` (`status`,`expires_at`);
--> statement-breakpoint
CREATE TABLE __new_provider_media_deliveries (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`execution_media_id` text NOT NULL,
	`publisher_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`remote_media_id` text,
	`remote_media_url` text,
	`remote_media_expires_at` integer,
	`last_attempt_at` integer,
	`completed_at` integer,
	`error_code` text,
	`error_message` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`execution_media_id`) REFERENCES `publication_execution_revision_media`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`publisher_id`) REFERENCES project_channel_publishers(project_id,publisher_id) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "provider_media_deliveries_provider_nonblank" CHECK(length(trim("__new_provider_media_deliveries"."provider_id")) > 0),
	CONSTRAINT "provider_media_deliveries_attempts_nonnegative" CHECK("__new_provider_media_deliveries"."attempts" >= 0),
	CONSTRAINT "provider_media_deliveries_state_valid" CHECK("__new_provider_media_deliveries"."state" in ('pending', 'uploading', 'uploaded', 'failed', 'ambiguous')),
	CONSTRAINT "provider_media_deliveries_timestamps_valid" CHECK(("__new_provider_media_deliveries"."last_attempt_at" is null or "__new_provider_media_deliveries"."last_attempt_at" >= "__new_provider_media_deliveries"."created_at")
                and ("__new_provider_media_deliveries"."completed_at" is null or "__new_provider_media_deliveries"."completed_at" >= "__new_provider_media_deliveries"."created_at")
                and ("__new_provider_media_deliveries"."remote_media_expires_at" is null
                    or ("__new_provider_media_deliveries"."completed_at" is not null and "__new_provider_media_deliveries"."remote_media_expires_at" >= "__new_provider_media_deliveries"."completed_at"))),
	CONSTRAINT "provider_media_deliveries_state_data_valid" CHECK(("__new_provider_media_deliveries"."state" = 'pending'
                    and "__new_provider_media_deliveries"."attempts" >= 0
                    and ("__new_provider_media_deliveries"."last_attempt_at" is null or "__new_provider_media_deliveries"."last_attempt_at" >= "__new_provider_media_deliveries"."created_at")
                    and "__new_provider_media_deliveries"."completed_at" is null
                    and "__new_provider_media_deliveries"."remote_media_id" is null
                    and "__new_provider_media_deliveries"."remote_media_url" is null
                    and "__new_provider_media_deliveries"."remote_media_expires_at" is null
                    and "__new_provider_media_deliveries"."error_code" is null
                    and "__new_provider_media_deliveries"."error_message" is null)
                or ("__new_provider_media_deliveries"."state" = 'uploading'
                    and "__new_provider_media_deliveries"."attempts" > 0
                    and "__new_provider_media_deliveries"."last_attempt_at" is not null
                    and "__new_provider_media_deliveries"."completed_at" is null
                    and "__new_provider_media_deliveries"."remote_media_expires_at" is null
                    and "__new_provider_media_deliveries"."error_code" is null
                    and "__new_provider_media_deliveries"."error_message" is null)
                or ("__new_provider_media_deliveries"."state" = 'uploaded'
                    and "__new_provider_media_deliveries"."attempts" > 0
                    and "__new_provider_media_deliveries"."completed_at" is not null
                    and "__new_provider_media_deliveries"."remote_media_id" is not null
                    and length(trim("__new_provider_media_deliveries"."remote_media_id")) > 0
                    and ("__new_provider_media_deliveries"."remote_media_expires_at" is null
                        or "__new_provider_media_deliveries"."remote_media_expires_at" >= "__new_provider_media_deliveries"."completed_at")
                    and "__new_provider_media_deliveries"."error_code" is null
                    and "__new_provider_media_deliveries"."error_message" is null)
                or ("__new_provider_media_deliveries"."state" in ('failed', 'ambiguous')
                    and "__new_provider_media_deliveries"."attempts" > 0
                    and "__new_provider_media_deliveries"."completed_at" is not null
                    and "__new_provider_media_deliveries"."remote_media_expires_at" is null
                    and "__new_provider_media_deliveries"."error_code" is not null
                    and length(trim("__new_provider_media_deliveries"."error_code")) > 0
                    and "__new_provider_media_deliveries"."error_message" is not null
                    and length(trim("__new_provider_media_deliveries"."error_message")) > 0)),
	CONSTRAINT "provider_media_deliveries_url_valid" CHECK("__new_provider_media_deliveries"."remote_media_url" is null or length(trim("__new_provider_media_deliveries"."remote_media_url")) > 0)
);
--> statement-breakpoint
INSERT INTO __new_provider_media_deliveries (id,project_id,execution_media_id,publisher_id,provider_id,state,attempts,remote_media_id,remote_media_url,remote_media_expires_at,last_attempt_at,completed_at,error_code,error_message,created_at,updated_at) SELECT old.id,old.project_id,old.execution_media_id,old.publisher_id,old.provider_id,old.state,old.attempts,old.remote_media_id,old.remote_media_url,old.remote_media_expires_at,old.last_attempt_at,old.completed_at,old.error_code,old.error_message,old.created_at,old.updated_at FROM provider_media_deliveries old;
--> statement-breakpoint
DROP TABLE provider_media_deliveries;
--> statement-breakpoint
ALTER TABLE __new_provider_media_deliveries RENAME TO provider_media_deliveries;
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_media_deliveries_project_id_id_uidx` ON `provider_media_deliveries` (`project_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_media_deliveries_execution_provider_uidx` ON `provider_media_deliveries` (`project_id`,`execution_media_id`,`publisher_id`,`provider_id`);
--> statement-breakpoint
CREATE INDEX `provider_media_deliveries_project_state_idx` ON `provider_media_deliveries` (`project_id`,`state`);
--> statement-breakpoint
CREATE TABLE __new_publication_execution_revisions (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`job_id` text NOT NULL,
	`publication_id` text NOT NULL,
	`target_revision_id` text NOT NULL,
	`profile_version_id` text NOT NULL,
	`delivery_mode` text NOT NULL,
	`media_reference_count` integer DEFAULT 0 NOT NULL,
	`content_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`profile_hash` text NOT NULL,
	`schema_hash` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, `destination_snapshot_json` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`job_id`) REFERENCES `jobs`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`publication_id`) REFERENCES `publications`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`target_revision_id`) REFERENCES `publication_target_revisions`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`profile_version_id`) REFERENCES project_channel_profiles(project_id,profile_id) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publication_execution_revisions_delivery_mode_automatic" CHECK("__new_publication_execution_revisions"."delivery_mode" = 'automatic'),
	CONSTRAINT "publication_execution_revisions_content_object" CHECK(json_valid("__new_publication_execution_revisions"."content_json") and json_type("__new_publication_execution_revisions"."content_json") = 'object'),
	CONSTRAINT "publication_execution_revisions_hashes_nonblank" CHECK(length(trim("__new_publication_execution_revisions"."content_hash")) > 0 and length(trim("__new_publication_execution_revisions"."profile_hash")) > 0 and length(trim("__new_publication_execution_revisions"."schema_hash")) > 0),
	CONSTRAINT "publication_execution_revisions_media_reference_count_valid" CHECK("__new_publication_execution_revisions"."media_reference_count" >= 0)
);
--> statement-breakpoint
INSERT INTO __new_publication_execution_revisions (id,project_id,job_id,publication_id,target_revision_id,profile_version_id,delivery_mode,media_reference_count,content_json,content_hash,profile_hash,schema_hash,created_at,destination_snapshot_json) SELECT old.id,old.project_id,old.job_id,old.publication_id,old.target_revision_id,old.profile_version_id,old.delivery_mode,old.media_reference_count,old.content_json,old.content_hash,old.profile_hash,old.schema_hash,old.created_at,old.destination_snapshot_json FROM publication_execution_revisions old;
--> statement-breakpoint
DROP TABLE publication_execution_revisions;
--> statement-breakpoint
ALTER TABLE __new_publication_execution_revisions RENAME TO publication_execution_revisions;
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_execution_revisions_project_job_uidx` ON `publication_execution_revisions` (`project_id`,`job_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_execution_revisions_project_id_id_uidx` ON `publication_execution_revisions` (`project_id`,`id`);
--> statement-breakpoint
CREATE TABLE __new_publication_target_revisions (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`publication_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`profile_version_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`delivery_mode` text NOT NULL,
	`media_reference_count` integer DEFAULT 0 NOT NULL,
	`content_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`profile_hash` text NOT NULL,
	`schema_hash` text NOT NULL,
	`validation_issues_json` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`publication_id`) REFERENCES `publications`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`profile_version_id`) REFERENCES project_channel_profiles(project_id,profile_id) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`created_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publication_target_revisions_sequence_positive" CHECK("__new_publication_target_revisions"."sequence" > 0),
	CONSTRAINT "publication_target_revisions_source_revision_positive" CHECK("__new_publication_target_revisions"."source_revision" > 0),
	CONSTRAINT "publication_target_revisions_content_object" CHECK(json_valid("__new_publication_target_revisions"."content_json") and json_type("__new_publication_target_revisions"."content_json") = 'object'),
	CONSTRAINT "publication_target_revisions_validation_issues_array" CHECK(json_valid("__new_publication_target_revisions"."validation_issues_json") and json_type("__new_publication_target_revisions"."validation_issues_json") = 'array'),
	CONSTRAINT "publication_target_revisions_hashes_nonblank" CHECK(length(trim("__new_publication_target_revisions"."content_hash")) > 0 and length(trim("__new_publication_target_revisions"."profile_hash")) > 0 and length(trim("__new_publication_target_revisions"."schema_hash")) > 0),
	CONSTRAINT "publication_target_revisions_delivery_mode_valid" CHECK("__new_publication_target_revisions"."delivery_mode" in ('manual', 'automatic')),
	CONSTRAINT "publication_target_revisions_media_reference_count_valid" CHECK("__new_publication_target_revisions"."media_reference_count" >= 0)
);
--> statement-breakpoint
INSERT INTO __new_publication_target_revisions (id,project_id,publication_id,sequence,profile_version_id,source_revision,delivery_mode,media_reference_count,content_json,content_hash,profile_hash,schema_hash,validation_issues_json,created_by_actor_id,created_at) SELECT old.id,old.project_id,old.publication_id,old.sequence,old.profile_version_id,old.source_revision,old.delivery_mode,old.media_reference_count,old.content_json,old.content_hash,old.profile_hash,old.schema_hash,old.validation_issues_json,old.created_by_actor_id,old.created_at FROM publication_target_revisions old;
--> statement-breakpoint
DROP TABLE publication_target_revisions;
--> statement-breakpoint
ALTER TABLE __new_publication_target_revisions RENAME TO publication_target_revisions;
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_target_revisions_project_id_id_uidx` ON `publication_target_revisions` (`project_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_target_revisions_project_publication_sequence_uidx` ON `publication_target_revisions` (`project_id`,`publication_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `publication_target_revisions_project_publication_idx` ON `publication_target_revisions` (`project_id`,`publication_id`);
--> statement-breakpoint
CREATE TABLE __new_publication_working_drafts (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`publication_id` text NOT NULL,
	`profile_version_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`base_source_content` text DEFAULT '{}' NOT NULL,
	`content_json` text NOT NULL,
	`review_state` text NOT NULL,
	`validation_issues_json` text NOT NULL,
	`last_assessed_profile_version_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_by_actor_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`publication_id`) REFERENCES `publications`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`profile_version_id`) REFERENCES project_channel_profiles(project_id,profile_id) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`last_assessed_profile_version_id`) REFERENCES project_channel_profiles(project_id,profile_id) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`updated_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publication_working_drafts_source_revision_positive" CHECK("__new_publication_working_drafts"."source_revision" > 0),
	CONSTRAINT "publication_working_drafts_content_object" CHECK(json_valid("__new_publication_working_drafts"."content_json") and json_type("__new_publication_working_drafts"."content_json") = 'object'),
	CONSTRAINT "publication_working_drafts_validation_issues_array" CHECK(json_valid("__new_publication_working_drafts"."validation_issues_json") and json_type("__new_publication_working_drafts"."validation_issues_json") = 'array'),
	CONSTRAINT "publication_working_drafts_review_state_valid" CHECK("__new_publication_working_drafts"."review_state" in ('compatible', 'review_required')),
	CONSTRAINT "publication_working_drafts_revision_positive" CHECK("__new_publication_working_drafts"."revision" > 0)
);
--> statement-breakpoint
INSERT INTO __new_publication_working_drafts (id,project_id,publication_id,profile_version_id,source_revision,base_source_content,content_json,review_state,validation_issues_json,last_assessed_profile_version_id,revision,updated_by_actor_id,created_at,updated_at) SELECT old.id,old.project_id,old.publication_id,old.profile_version_id,old.source_revision,old.base_source_content,old.content_json,old.review_state,old.validation_issues_json,old.last_assessed_profile_version_id,old.revision,old.updated_by_actor_id,old.created_at,old.updated_at FROM publication_working_drafts old;
--> statement-breakpoint
DROP TABLE publication_working_drafts;
--> statement-breakpoint
ALTER TABLE __new_publication_working_drafts RENAME TO publication_working_drafts;
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_working_drafts_project_publication_uidx` ON `publication_working_drafts` (`project_id`,`publication_id`);
--> statement-breakpoint
CREATE INDEX `publication_working_drafts_project_review_idx` ON `publication_working_drafts` (`project_id`,`review_state`);
--> statement-breakpoint
CREATE TABLE __new_publications (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`post_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`target_revision_id` text,
	`delivery_mode` text NOT NULL,
	`review_state` text NOT NULL,
	`state` text NOT NULL,
	`scheduled_at` integer,
	`published_at` integer,
	`external_id` text,
	`external_url` text,
	`error_message` text,
	`created_by_actor_id` text NOT NULL,
	`scheduled_by_actor_id` text,
	`state_changed_by_actor_id` text NOT NULL,
	`published_by_actor_id` text,
	`last_assessed_profile_version_id` text,
	`profile_assessment_issues_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, `confirmed_destination_revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`post_id`) REFERENCES `posts`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`channel_id`) REFERENCES project_channel_attachments(project_id,channel_id) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`created_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`scheduled_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`state_changed_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`published_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`last_assessed_profile_version_id`) REFERENCES project_channel_profiles(project_id,profile_id) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publications_target_revision_id_nonblank" CHECK("__new_publications"."target_revision_id" is null or length(trim("__new_publications"."target_revision_id")) > 0),
	CONSTRAINT "publications_delivery_mode_valid" CHECK("__new_publications"."delivery_mode" in ('manual', 'automatic')),
	CONSTRAINT "publications_review_state_valid" CHECK("__new_publications"."review_state" in ('compatible', 'review_required')),
	CONSTRAINT "publications_profile_assessment_issues_array" CHECK(json_valid("__new_publications"."profile_assessment_issues_json") and json_type("__new_publications"."profile_assessment_issues_json") = 'array'),
	CONSTRAINT "publications_scheduled_target_valid" CHECK("__new_publications"."state" <> 'scheduled' or "__new_publications"."target_revision_id" is not null),
	CONSTRAINT "publications_state_valid" CHECK("__new_publications"."state" in ('draft', 'scheduled', 'ready', 'publishing', 'published', 'failed', 'ambiguous', 'cancelled')),
	CONSTRAINT "publications_schedule_consistent" CHECK(("__new_publications"."scheduled_at" is null and "__new_publications"."scheduled_by_actor_id" is null) or ("__new_publications"."scheduled_at" is not null and "__new_publications"."scheduled_by_actor_id" is not null)),
	CONSTRAINT "publications_scheduled_state_has_time" CHECK("__new_publications"."state" <> 'scheduled' or "__new_publications"."scheduled_at" is not null),
	CONSTRAINT "publications_published_state_complete" CHECK("__new_publications"."state" <> 'published' or ("__new_publications"."published_at" is not null and "__new_publications"."published_by_actor_id" is not null)),
	CONSTRAINT "publications_unpublished_state_has_no_result" CHECK("__new_publications"."state" = 'published' or ("__new_publications"."published_at" is null and "__new_publications"."published_by_actor_id" is null)),
	CONSTRAINT "publications_failure_has_error" CHECK("__new_publications"."state" not in ('failed', 'ambiguous') or ("__new_publications"."error_message" is not null and length(trim("__new_publications"."error_message")) > 0)),
	CONSTRAINT "publications_nonfailure_has_no_error" CHECK("__new_publications"."state" in ('failed', 'ambiguous') or "__new_publications"."error_message" is null)
);
--> statement-breakpoint
INSERT INTO __new_publications (id,project_id,post_id,channel_id,target_revision_id,delivery_mode,review_state,state,scheduled_at,published_at,external_id,external_url,error_message,created_by_actor_id,scheduled_by_actor_id,state_changed_by_actor_id,published_by_actor_id,last_assessed_profile_version_id,profile_assessment_issues_json,created_at,updated_at,confirmed_destination_revision) SELECT old.id,old.project_id,old.post_id,old.channel_id,old.target_revision_id,old.delivery_mode,old.review_state,old.state,old.scheduled_at,old.published_at,old.external_id,old.external_url,old.error_message,old.created_by_actor_id,old.scheduled_by_actor_id,old.state_changed_by_actor_id,old.published_by_actor_id,old.last_assessed_profile_version_id,old.profile_assessment_issues_json,old.created_at,old.updated_at,old.confirmed_destination_revision FROM publications old;
--> statement-breakpoint
DROP TABLE publications;
--> statement-breakpoint
ALTER TABLE __new_publications RENAME TO publications;
--> statement-breakpoint
CREATE UNIQUE INDEX `publications_project_id_id_uidx` ON `publications` (`project_id`,`id`);
--> statement-breakpoint
CREATE INDEX `publications_project_id_post_id_idx` ON `publications` (`project_id`,`post_id`);
--> statement-breakpoint
CREATE INDEX `publications_project_id_channel_id_idx` ON `publications` (`project_id`,`channel_id`);
--> statement-breakpoint
CREATE INDEX `publications_state_scheduled_at_idx` ON `publications` (`state`,`scheduled_at`);
--> statement-breakpoint
CREATE INDEX `publications_project_id_created_by_actor_id_idx` ON `publications` (`project_id`,`created_by_actor_id`);
--> statement-breakpoint
CREATE INDEX `publications_project_id_scheduled_by_actor_id_idx` ON `publications` (`project_id`,`scheduled_by_actor_id`);
--> statement-breakpoint
CREATE INDEX `publications_project_id_state_changed_by_actor_id_idx` ON `publications` (`project_id`,`state_changed_by_actor_id`);
--> statement-breakpoint
CREATE INDEX `publications_project_id_published_by_actor_id_idx` ON `publications` (`project_id`,`published_by_actor_id`);
--> statement-breakpoint
CREATE TABLE __new_publication_draft_adoptions (
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
	FOREIGN KEY (`project_id`,`profile_version_id`) REFERENCES project_channel_profiles(project_id,profile_id) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`adopted_profile_version_id`) REFERENCES project_channel_profiles(project_id,profile_id) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`created_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`,`target_revision_id`) REFERENCES `publication_target_revisions`(`project_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publication_draft_adoptions_snapshot_object" CHECK(json_valid("__new_publication_draft_adoptions"."snapshot_json") and json_type("__new_publication_draft_adoptions"."snapshot_json") = 'object'),
	CONSTRAINT "publication_draft_adoptions_local_object" CHECK("__new_publication_draft_adoptions"."local_content_json" is null or (json_valid("__new_publication_draft_adoptions"."local_content_json") and json_type("__new_publication_draft_adoptions"."local_content_json") = 'object'))
);
--> statement-breakpoint
INSERT INTO __new_publication_draft_adoptions (id,project_id,publication_id,profile_version_id,adopted_profile_version_id,snapshot_json,local_content_json,target_revision_id,created_by_actor_id,created_at) SELECT old.id,old.project_id,old.publication_id,old.profile_version_id,old.adopted_profile_version_id,old.snapshot_json,old.local_content_json,old.target_revision_id,old.created_by_actor_id,old.created_at FROM publication_draft_adoptions old;
--> statement-breakpoint
DROP TABLE publication_draft_adoptions;
--> statement-breakpoint
ALTER TABLE __new_publication_draft_adoptions RENAME TO publication_draft_adoptions;
--> statement-breakpoint
CREATE INDEX `publication_draft_adoptions_publication_idx` ON `publication_draft_adoptions` (`project_id`,`publication_id`);
--> statement-breakpoint
CREATE TRIGGER shared_channels_cleanup_project_attachments AFTER DELETE ON projects BEGIN
 DELETE FROM project_channel_attachments WHERE project_id=OLD.id; END;
--> statement-breakpoint
CREATE TRIGGER shared_channel_attachment_identity_immutable BEFORE UPDATE OF project_id,channel_id,workspace_id ON project_channel_attachments
 WHEN NEW.project_id<>OLD.project_id OR NEW.channel_id<>OLD.channel_id OR NEW.workspace_id<>OLD.workspace_id
 BEGIN SELECT RAISE(ABORT,'attachment_identity_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER jobs_lifecycle_admission BEFORE UPDATE OF state ON jobs
WHEN NEW.state = 'running' AND OLD.state <> 'running' AND EXISTS (
 SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active'
) BEGIN SELECT RAISE(IGNORE); END;
--> statement-breakpoint
CREATE TRIGGER publication_comment_replies_lifecycle_admission BEFORE UPDATE OF state ON publication_comment_replies
WHEN NEW.state = 'running' AND OLD.state <> 'running' AND EXISTS (
 SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active'
) BEGIN SELECT RAISE(IGNORE); END;
--> statement-breakpoint
CREATE TRIGGER publication_first_comments_lifecycle_admission BEFORE UPDATE OF state ON publication_first_comments
WHEN NEW.state = 'running' AND OLD.state <> 'running' AND EXISTS (
 SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active'
) BEGIN SELECT RAISE(IGNORE); END;
--> statement-breakpoint
CREATE TRIGGER notification_deliveries_lifecycle_admission BEFORE UPDATE OF state ON notification_deliveries
WHEN NEW.state = 'running' AND OLD.state <> 'running' AND EXISTS (
 SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active'
) BEGIN SELECT RAISE(IGNORE); END;
--> statement-breakpoint
CREATE TRIGGER posts_archived_insert BEFORE INSERT ON posts
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;
--> statement-breakpoint
CREATE TRIGGER posts_archived_update BEFORE UPDATE ON posts
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;
--> statement-breakpoint
CREATE TRIGGER publication_composer_drafts_archived_insert BEFORE INSERT ON publication_composer_drafts
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;
--> statement-breakpoint
CREATE TRIGGER publication_composer_drafts_archived_update BEFORE UPDATE ON publication_composer_drafts
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;
--> statement-breakpoint
CREATE TRIGGER channels_archived_insert BEFORE INSERT ON channels
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'workspace' AND resource_id = NEW.workspace_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;
--> statement-breakpoint
CREATE TRIGGER channels_archived_update BEFORE UPDATE ON channels
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'workspace' AND resource_id = NEW.workspace_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;
--> statement-breakpoint
CREATE TRIGGER channel_profile_versions_archived_insert BEFORE INSERT ON channel_profile_versions
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'workspace' AND resource_id = NEW.workspace_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;
--> statement-breakpoint
CREATE TRIGGER channel_profile_versions_archived_update BEFORE UPDATE ON channel_profile_versions
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'workspace' AND resource_id = NEW.workspace_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;
--> statement-breakpoint
CREATE TRIGGER publication_working_drafts_archived_insert BEFORE INSERT ON publication_working_drafts
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;
--> statement-breakpoint
CREATE TRIGGER publication_working_drafts_archived_update BEFORE UPDATE ON publication_working_drafts
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;
--> statement-breakpoint
CREATE TRIGGER publication_target_revisions_archived_insert BEFORE INSERT ON publication_target_revisions
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;
--> statement-breakpoint
CREATE TRIGGER publication_target_revisions_archived_update BEFORE UPDATE ON publication_target_revisions
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;
--> statement-breakpoint
CREATE TRIGGER publication_comment_replies_archived_insert BEFORE INSERT ON publication_comment_replies
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;
--> statement-breakpoint
CREATE TRIGGER publication_comment_replies_archived_update BEFORE UPDATE ON publication_comment_replies
WHEN OLD.state <> 'running' AND EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;
--> statement-breakpoint
CREATE TRIGGER publications_retirement_insert BEFORE INSERT ON publications
WHEN NEW.state IN ('draft', 'scheduled', 'ready') AND EXISTS (
 SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active'
) BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;
--> statement-breakpoint
CREATE TRIGGER publications_retirement_update BEFORE UPDATE ON publications
WHEN OLD.state <> 'publishing' AND NEW.state IN ('draft', 'scheduled', 'ready') AND EXISTS (
 SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active'
) BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;
--> statement-breakpoint
CREATE TRIGGER projects_lifecycle_identity BEFORE INSERT ON projects
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'resource_identity_reserved'); END;
--> statement-breakpoint
CREATE TRIGGER workspaces_lifecycle_identity BEFORE INSERT ON workspaces
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'workspace' AND resource_id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'resource_identity_reserved'); END;
--> statement-breakpoint
CREATE TRIGGER media_assets_retirement_insert BEFORE INSERT ON media_assets
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;
--> statement-breakpoint
CREATE TRIGGER media_representations_retirement_insert BEFORE INSERT ON media_representations
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;
--> statement-breakpoint
CREATE TRIGGER media_upload_intents_retirement_insert BEFORE INSERT ON media_upload_intents
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;
--> statement-breakpoint
CREATE TRIGGER publisher_connections_retirement_insert BEFORE INSERT ON publisher_connections
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'workspace' AND resource_id = NEW.workspace_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;
--> statement-breakpoint
CREATE TRIGGER publishers_retirement_insert BEFORE INSERT ON publishers
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'workspace' AND resource_id = NEW.workspace_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;
--> statement-breakpoint
CREATE TRIGGER publication_first_comments_retirement_insert BEFORE INSERT ON publication_first_comments
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;
--> statement-breakpoint
CREATE TRIGGER notification_deliveries_retirement_insert BEFORE INSERT ON notification_deliveries
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(IGNORE); END;
--> statement-breakpoint
CREATE TRIGGER `actors_cleanup_after_project_delete` AFTER DELETE ON `projects`
BEGIN DELETE FROM actors WHERE project_id = OLD.id; END;
--> statement-breakpoint
CREATE TRIGGER `actors_cleanup_after_workspace_delete` AFTER DELETE ON `workspaces`
BEGIN DELETE FROM actors WHERE workspace_id = OLD.id; END;
--> statement-breakpoint
DROP TABLE __share_managers;
--> statement-breakpoint
DROP TABLE __share_actor_map;
--> statement-breakpoint
DROP TABLE __share_migration_time;
--> statement-breakpoint
DROP TABLE __share_ownership_guard;

--> statement-breakpoint
CREATE TRIGGER shared_channels_publication_admission BEFORE INSERT ON publications
WHEN NOT EXISTS (SELECT 1 FROM project_channel_attachments a WHERE a.project_id=NEW.project_id AND a.channel_id=NEW.channel_id AND a.state='active')
BEGIN SELECT RAISE(ABORT,'channel_detached'); END;

--> statement-breakpoint
CREATE TRIGGER shared_channels_jobs_effect_admission BEFORE UPDATE OF effect_started_at ON jobs
WHEN OLD.effect_started_at IS NULL AND NEW.effect_started_at IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM publications p JOIN project_channel_attachments a ON a.project_id=p.project_id AND a.channel_id=p.channel_id
 WHERE p.project_id=NEW.project_id AND p.id=NEW.publication_id AND a.state='active'
)
BEGIN SELECT RAISE(IGNORE); END;

--> statement-breakpoint
CREATE TRIGGER shared_channels_publication_comment_replies_effect_admission BEFORE UPDATE OF effect_started_at ON publication_comment_replies
WHEN OLD.effect_started_at IS NULL AND NEW.effect_started_at IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM publications p JOIN project_channel_attachments a ON a.project_id=p.project_id AND a.channel_id=p.channel_id
 WHERE p.project_id=NEW.project_id AND p.id=NEW.publication_id AND a.state='active'
)
BEGIN SELECT RAISE(IGNORE); END;

--> statement-breakpoint
CREATE TRIGGER shared_channels_publication_first_comments_effect_admission BEFORE UPDATE OF effect_started_at ON publication_first_comments
WHEN OLD.effect_started_at IS NULL AND NEW.effect_started_at IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM publications p JOIN project_channel_attachments a ON a.project_id=p.project_id AND a.channel_id=p.channel_id
 WHERE p.project_id=NEW.project_id AND p.id=NEW.publication_id AND a.state='active'
)
BEGIN SELECT RAISE(IGNORE); END;

--> statement-breakpoint
CREATE INDEX project_channel_attachments_channel_state_idx ON project_channel_attachments(channel_id,state,project_id);
--> statement-breakpoint
CREATE INDEX channel_managers_workspace_project_idx ON channel_managers(workspace_id,project_id);
--> statement-breakpoint
CREATE INDEX publisher_credentials_workspace_provider_external_idx ON publisher_credentials(workspace_id,provider_id,external_account_id);
--> statement-breakpoint
CREATE TRIGGER shared_channels_detach_manager AFTER UPDATE OF state ON project_channel_attachments
WHEN NEW.state='detached'
BEGIN DELETE FROM channel_managers WHERE project_id=NEW.project_id AND channel_id=NEW.channel_id; END;
--> statement-breakpoint
CREATE TRIGGER shared_channels_manager_insert BEFORE INSERT ON channel_managers
WHEN NOT EXISTS(SELECT 1 FROM project_channel_attachments a WHERE a.project_id=NEW.project_id AND a.channel_id=NEW.channel_id AND a.state='active')
BEGIN SELECT RAISE(ABORT,'manager_requires_active_attachment'); END;
--> statement-breakpoint
CREATE TRIGGER shared_channels_manager_update BEFORE UPDATE ON channel_managers
WHEN NOT EXISTS(SELECT 1 FROM project_channel_attachments a WHERE a.project_id=NEW.project_id AND a.channel_id=NEW.channel_id AND a.state='active')
BEGIN SELECT RAISE(ABORT,'manager_requires_active_attachment'); END;

--> statement-breakpoint
CREATE TRIGGER project_channel_profiles_on_reattach AFTER UPDATE OF state ON project_channel_attachments
WHEN NEW.state='active' AND OLD.state='detached'
BEGIN INSERT INTO project_channel_profiles SELECT NEW.project_id,NEW.channel_id,p.id FROM channel_profile_versions p WHERE p.channel_id=NEW.channel_id AND NOT EXISTS(SELECT 1 FROM project_channel_profiles b WHERE b.project_id=NEW.project_id AND b.profile_id=p.id); END;

--> statement-breakpoint
CREATE TRIGGER project_channel_publishers_on_reattach AFTER UPDATE OF state ON project_channel_attachments
WHEN NEW.state='active' AND OLD.state='detached'
BEGIN INSERT INTO project_channel_publishers SELECT NEW.project_id,NEW.channel_id,p.id FROM publishers p WHERE p.channel_id=NEW.channel_id AND NOT EXISTS(SELECT 1 FROM project_channel_publishers b WHERE b.project_id=NEW.project_id AND b.publisher_id=p.id); END;

--> statement-breakpoint
CREATE VIEW project_channel_contexts AS
 SELECT a.project_id,c.*,a.state AS attachment_state,a.revision AS attachment_revision FROM project_channel_attachments a JOIN channels c ON c.workspace_id=a.workspace_id AND c.id=a.channel_id;
--> statement-breakpoint
CREATE VIEW project_channel_profile_contexts AS
 -- Historical readers still need the channel's current metadata after detach.
 -- This view is not admission: new references use the active-derived bindings.
 SELECT a.project_id,p.* FROM project_channel_attachments a JOIN channel_profile_versions p ON p.workspace_id=a.workspace_id AND p.channel_id=a.channel_id;
--> statement-breakpoint
CREATE VIEW project_publisher_contexts AS
 SELECT b.project_id,p.* FROM project_channel_publishers b JOIN publishers p ON p.channel_id=b.channel_id AND p.id=b.publisher_id;
--> statement-breakpoint
CREATE VIEW project_publisher_connection_contexts AS
 SELECT b.project_id,c.* FROM project_channel_publishers b JOIN publishers p ON p.channel_id=b.channel_id AND p.id=b.publisher_id JOIN publisher_connections c ON c.workspace_id=p.workspace_id AND c.publisher_id=p.id;
--> statement-breakpoint
CREATE VIEW project_publisher_credential_contexts AS
 SELECT p.id AS project_id,c.* FROM projects p JOIN publisher_credentials c ON c.workspace_id=p.workspace_id
 WHERE EXISTS(SELECT 1 FROM publisher_connections connection JOIN publishers publisher ON publisher.workspace_id=connection.workspace_id AND publisher.id=connection.publisher_id JOIN project_channel_attachments a ON a.workspace_id=publisher.workspace_id AND a.channel_id=publisher.channel_id WHERE a.project_id=p.id AND connection.credential_id=c.id);
