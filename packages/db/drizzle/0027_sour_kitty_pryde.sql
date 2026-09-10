CREATE TABLE `access_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`target_email` text NOT NULL,
	`token_hash` text NOT NULL,
	`instance_role` text DEFAULT 'member' NOT NULL,
	`project_id` text,
	`project_role` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_by_user_id` text,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`accepted_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "access_invitations_email_nonblank" CHECK(length(trim("access_invitations"."target_email")) > 0),
	CONSTRAINT "access_invitations_token_hash_nonblank" CHECK(length(trim("access_invitations"."token_hash")) > 0),
	CONSTRAINT "access_invitations_instance_role_valid" CHECK("access_invitations"."instance_role" = 'member'),
	CONSTRAINT "access_invitations_project_scope_valid" CHECK(("access_invitations"."project_id" is null and "access_invitations"."project_role" is null)
                or ("access_invitations"."project_id" is not null and "access_invitations"."project_role" is not null)),
	CONSTRAINT "access_invitations_state_valid" CHECK(("access_invitations"."state" = 'pending' and "access_invitations"."accepted_at" is null and "access_invitations"."accepted_by_user_id" is null and "access_invitations"."revoked_at" is null)
                or ("access_invitations"."state" = 'accepted' and "access_invitations"."accepted_at" is not null and "access_invitations"."accepted_by_user_id" is not null and "access_invitations"."revoked_at" is null)
                or ("access_invitations"."state" = 'revoked' and "access_invitations"."accepted_at" is null and "access_invitations"."accepted_by_user_id" is null and "access_invitations"."revoked_at" is not null)
                or ("access_invitations"."state" = 'expired' and "access_invitations"."accepted_at" is null and "access_invitations"."accepted_by_user_id" is null and "access_invitations"."revoked_at" is null)),
	CONSTRAINT "access_invitations_expiry_valid" CHECK("access_invitations"."expires_at" > "access_invitations"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_invitations_token_hash_uidx` ON `access_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `access_invitations_target_state_idx` ON `access_invitations` (`target_email`,`state`);--> statement-breakpoint
CREATE INDEX `access_invitations_expiry_idx` ON `access_invitations` (`state`,`expires_at`);--> statement-breakpoint
CREATE TABLE `instance_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`state` text DEFAULT 'enabled' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "instance_memberships_role_valid" CHECK("instance_memberships"."role" in ('admin', 'member')),
	CONSTRAINT "instance_memberships_state_valid" CHECK("instance_memberships"."state" in ('enabled', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instance_memberships_user_uidx` ON `instance_memberships` (`user_id`);--> statement-breakpoint
CREATE TABLE `instance_state` (
	`id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`claimed_by_user_id` text,
	`claimed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`claimed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "instance_state_singleton" CHECK("instance_state"."id" = 'default'),
	CONSTRAINT "instance_state_value_valid" CHECK("instance_state"."state" in ('claimable', 'claimed')),
	CONSTRAINT "instance_state_claim_consistency" CHECK(("instance_state"."state" = 'claimable' and "instance_state"."claimed_by_user_id" is null and "instance_state"."claimed_at" is null)
                or ("instance_state"."state" = 'claimed' and "instance_state"."claimed_by_user_id" is not null and "instance_state"."claimed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE `project_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "project_memberships_role_valid" CHECK("project_memberships"."role" in ('owner', 'editor', 'viewer')),
	CONSTRAINT "project_memberships_state_valid" CHECK("project_memberships"."state" in ('active', 'removed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_memberships_project_user_uidx` ON `project_memberships` (`project_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `project_memberships_user_state_idx` ON `project_memberships` (`user_id`,`state`);--> statement-breakpoint
INSERT INTO instance_state (
	id, state, claimed_by_user_id, claimed_at, created_at, updated_at
)
SELECT
	'default',
	CASE WHEN count(*) > 0 THEN 'claimed' ELSE 'claimable' END,
	(SELECT id FROM user ORDER BY created_at, id LIMIT 1),
	(SELECT created_at FROM user ORDER BY created_at, id LIMIT 1),
	cast(unixepoch('subsecond') * 1000 as integer),
	cast(unixepoch('subsecond') * 1000 as integer)
FROM user;--> statement-breakpoint
INSERT INTO instance_memberships (
	id, user_id, role, state, created_at, updated_at
)
SELECT
	'instance-membership:' || users.id,
	users.id,
	CASE
		WHEN users.id = (SELECT id FROM user ORDER BY created_at, id LIMIT 1) THEN 'admin'
		ELSE 'member'
	END,
	'enabled',
	users.created_at,
	users.updated_at
FROM user AS users;--> statement-breakpoint
INSERT INTO project_memberships (
	id, project_id, user_id, role, state, created_at, updated_at
)
SELECT
	'project-membership:' || actors.project_id || ':' || actors.subject_id,
	actors.project_id,
	actors.subject_id,
	'owner',
	'active',
	min(actors.created_at),
	min(actors.updated_at)
FROM actors
INNER JOIN user AS users ON users.id = actors.subject_id
WHERE actors.kind = 'human'
GROUP BY actors.project_id, actors.subject_id;
