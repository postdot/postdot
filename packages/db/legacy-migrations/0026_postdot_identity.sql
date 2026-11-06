PRAGMA defer_foreign_keys = ON;--> statement-breakpoint
ALTER TABLE `provider_analytics_observations` RENAME COLUMN `postbot_entity_type` TO `postdot_entity_type`;--> statement-breakpoint
ALTER TABLE `provider_analytics_observations` RENAME COLUMN `postbot_entity_id` TO `postdot_entity_id`;--> statement-breakpoint
UPDATE `channel_profile_versions` SET
	`profile_json` = replace(`profile_json`, 'sha256:postbot-', 'sha256:postdot-'),
	`profile_hash` = replace(`profile_hash`, 'sha256:postbot-', 'sha256:postdot-'),
	`schema_hash` = replace(`schema_hash`, 'sha256:postbot-', 'sha256:postdot-')
WHERE `profile_hash` LIKE 'sha256:postbot-%' OR `schema_hash` LIKE 'sha256:postbot-%';--> statement-breakpoint
UPDATE `publication_target_revisions` SET
	`profile_hash` = replace(`profile_hash`, 'sha256:postbot-', 'sha256:postdot-'),
	`schema_hash` = replace(`schema_hash`, 'sha256:postbot-', 'sha256:postdot-')
WHERE `profile_hash` LIKE 'sha256:postbot-%' OR `schema_hash` LIKE 'sha256:postbot-%';--> statement-breakpoint
UPDATE `publication_execution_revisions` SET
	`profile_hash` = replace(`profile_hash`, 'sha256:postbot-', 'sha256:postdot-'),
	`schema_hash` = replace(`schema_hash`, 'sha256:postbot-', 'sha256:postdot-')
WHERE `profile_hash` LIKE 'sha256:postbot-%' OR `schema_hash` LIKE 'sha256:postbot-%';--> statement-breakpoint
UPDATE `publication_draft_adoptions` SET `snapshot_json` = replace(`snapshot_json`, 'sha256:postbot-', 'sha256:postdot-') WHERE `snapshot_json` LIKE '%sha256:postbot-%';--> statement-breakpoint
UPDATE `media_representations` SET `processor_id` = replace(`processor_id`, 'postbot-', 'postdot-') WHERE `processor_id` LIKE 'postbot-%';--> statement-breakpoint
UPDATE `team` SET `id` = 'postdot-' || substr(`id`, 9) WHERE `id` LIKE 'postbot-%';--> statement-breakpoint
UPDATE `team_member` SET
	`team_id` = 'postdot-' || substr(`team_id`, 9),
	`id` = replace('postdot-' || substr(`id`, 9), ':postbot-workspace-team:', ':postdot-workspace-team:'),
	`membership_key` = replace('postdot-' || substr(`membership_key`, 9), ':postbot-workspace-team:', ':postdot-workspace-team:')
WHERE `id` LIKE 'postbot-%' OR `team_id` LIKE 'postbot-%';--> statement-breakpoint
UPDATE `project_team_grants` SET
	`team_id` = 'postdot-' || substr(`team_id`, 9),
	`id` = replace('postdot-' || substr(`id`, 9), ':postbot-workspace-team:', ':postdot-workspace-team:')
WHERE `id` LIKE 'postbot-%' OR `team_id` LIKE 'postbot-%';--> statement-breakpoint
UPDATE `project_user_grants` SET `id` = 'postdot-' || substr(`id`, 9) WHERE `id` LIKE 'postbot-%';--> statement-breakpoint
UPDATE `member` SET `id` = 'postdot-' || substr(`id`, 9) WHERE `id` LIKE 'postbot-%';--> statement-breakpoint
UPDATE `organization` SET
	`slug` = CASE WHEN `slug` LIKE 'postbot-%' THEN 'postdot-' || substr(`slug`, 9) ELSE `slug` END,
	`metadata` = replace(replace(`metadata`, 'postbotResource', 'postdotResource'), 'postbotDefault', 'postdotDefault')
WHERE `slug` LIKE 'postbot-%' OR `metadata` LIKE '%postbot%';--> statement-breakpoint
UPDATE `workspaces` SET `slug` = 'postdot-' || substr(`slug`, 9) WHERE `slug` LIKE 'postbot-%';
