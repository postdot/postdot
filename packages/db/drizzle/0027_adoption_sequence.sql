ALTER TABLE `publication_draft_adoptions` ADD `sequence` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Preserve the historical insertion order (created_at, rowid) as an explicit,
-- engine-neutral sequence per publication before enforcing its uniqueness.
UPDATE `publication_draft_adoptions` SET `sequence` = (
	SELECT ordered.position FROM (
		SELECT `rowid` AS row_id,
			row_number() OVER (
				PARTITION BY `project_id`, `publication_id` ORDER BY `created_at`, `rowid`
			) AS position
		FROM `publication_draft_adoptions`
	) AS ordered
	WHERE ordered.row_id = `publication_draft_adoptions`.`rowid`
);--> statement-breakpoint
CREATE UNIQUE INDEX `publication_draft_adoptions_publication_sequence_uidx` ON `publication_draft_adoptions` (`project_id`,`publication_id`,`sequence`);
