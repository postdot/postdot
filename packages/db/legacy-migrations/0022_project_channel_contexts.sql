-- Project IDs in these read models identify editorial context, not resource ownership.
CREATE VIEW project_channel_contexts AS SELECT channels.*, 'active' AS attachment_state, 1 AS attachment_revision FROM channels;
--> statement-breakpoint
CREATE VIEW project_channel_profile_contexts AS SELECT channel_profile_versions.* FROM channel_profile_versions;
--> statement-breakpoint
CREATE VIEW project_publisher_contexts AS SELECT publishers.* FROM publishers;
--> statement-breakpoint
CREATE VIEW project_publisher_connection_contexts AS SELECT publisher_connections.* FROM publisher_connections;
--> statement-breakpoint
CREATE VIEW project_publisher_credential_contexts AS SELECT publisher_credentials.* FROM publisher_credentials;
