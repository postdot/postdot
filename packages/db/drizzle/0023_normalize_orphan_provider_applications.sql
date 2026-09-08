-- Credentials created before runtime-managed provider applications could carry
-- an application id that was not persisted in this database. The 0022 foreign
-- key intentionally exposes that inconsistency instead of silently accepting
-- it. Keep the encrypted credential, but make the missing application explicit:
-- it must be reconnected before it can be used with the new configuration
-- boundary.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
UPDATE `publisher_credentials`
SET `provider_application_id` = NULL,
    `state` = CASE WHEN `state` = 'active' THEN 'reconnect_required' ELSE `state` END,
    `revision` = `revision` + 1,
    `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `provider_application_id` IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM `provider_application_configurations`
      WHERE `provider_application_configurations`.`provider_id` = `publisher_credentials`.`provider_id`
        AND `provider_application_configurations`.`id` = `publisher_credentials`.`provider_application_id`
  );--> statement-breakpoint
UPDATE `oauth_authorization_attempts`
SET `provider_application_id` = NULL
WHERE `provider_application_id` IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM `provider_application_configurations`
      WHERE `provider_application_configurations`.`provider_id` = `oauth_authorization_attempts`.`provider_id`
        AND `provider_application_configurations`.`id` = `oauth_authorization_attempts`.`provider_application_id`
  );--> statement-breakpoint
PRAGMA foreign_keys=ON;
