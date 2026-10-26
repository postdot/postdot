CREATE TABLE `resource_cleanup_objects` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text,
	`store_id` text NOT NULL,
	`object_key` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "resource_cleanup_attempts_valid" CHECK("resource_cleanup_objects"."attempts" >= 0)
);
--> statement-breakpoint
CREATE INDEX `resource_cleanup_project_idx` ON `resource_cleanup_objects` (`project_id`);--> statement-breakpoint
CREATE INDEX `resource_cleanup_workspace_idx` ON `resource_cleanup_objects` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `resource_cleanup_updated_idx` ON `resource_cleanup_objects` (`updated_at`);--> statement-breakpoint
CREATE TABLE `resource_lifecycle_events` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`resource_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_id` text NOT NULL,
	`impact_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `resource_lifecycles` (
	`kind` text NOT NULL,
	`resource_id` text NOT NULL,
	`name` text NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`actor_id` text NOT NULL,
	`impact_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`kind`, `resource_id`),
	CONSTRAINT "resource_lifecycles_kind_valid" CHECK("resource_lifecycles"."kind" in ('project', 'workspace')),
	CONSTRAINT "resource_lifecycles_state_valid" CHECK("resource_lifecycles"."state" in ('active', 'archiving', 'archived', 'deleting', 'deleted')),
	CONSTRAINT "resource_lifecycles_revision_valid" CHECK("resource_lifecycles"."revision" > 0),
	CONSTRAINT "resource_lifecycles_impact_valid" CHECK(json_valid("resource_lifecycles"."impact_json") and json_type("resource_lifecycles"."impact_json") = 'object')
);
--> statement-breakpoint
CREATE INDEX `resource_lifecycles_state_updated_idx` ON `resource_lifecycles` (`state`,`updated_at`);
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
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

--> statement-breakpoint
CREATE TRIGGER channels_archived_update BEFORE UPDATE ON channels
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;



--> statement-breakpoint
CREATE TRIGGER channel_profile_versions_archived_insert BEFORE INSERT ON channel_profile_versions
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

--> statement-breakpoint
CREATE TRIGGER channel_profile_versions_archived_update BEFORE UPDATE ON channel_profile_versions
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
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
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

--> statement-breakpoint
CREATE TRIGGER publishers_retirement_insert BEFORE INSERT ON publishers
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

--> statement-breakpoint
CREATE TRIGGER publication_first_comments_retirement_insert BEFORE INSERT ON publication_first_comments
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(ABORT, 'resource_read_only'); END;

--> statement-breakpoint
CREATE TRIGGER notification_deliveries_retirement_insert BEFORE INSERT ON notification_deliveries
WHEN EXISTS (SELECT 1 FROM resource_lifecycles WHERE kind = 'project' AND resource_id = NEW.project_id AND state <> 'active')
BEGIN SELECT RAISE(IGNORE); END;
