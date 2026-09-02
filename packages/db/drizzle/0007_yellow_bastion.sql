-- A stale draft has no recoverable base snapshot in the legacy schema. Refuse
-- that migration instead of manufacturing a snapshot with the wrong revision.
CREATE TEMP TABLE `herald_0007_source_snapshot_guard` (
    `valid` integer NOT NULL CHECK (`valid` = 1)
);--> statement-breakpoint

INSERT INTO `herald_0007_source_snapshot_guard` (`valid`)
SELECT CASE
    WHEN EXISTS (
        SELECT 1
        FROM publication_working_drafts
        INNER JOIN publications
            ON publications.project_id = publication_working_drafts.project_id
           AND publications.id = publication_working_drafts.publication_id
        INNER JOIN posts
            ON posts.project_id = publications.project_id
           AND posts.id = publications.post_id
        WHERE posts.source_revision <> publication_working_drafts.source_revision
    ) THEN 0
    ELSE 1
END;
--> statement-breakpoint

DROP TABLE `herald_0007_source_snapshot_guard`;--> statement-breakpoint

ALTER TABLE `publication_working_drafts` ADD `base_source_content` text DEFAULT '{}' NOT NULL;--> statement-breakpoint

UPDATE publication_working_drafts
SET base_source_content = (
    SELECT posts.source_content
    FROM publications
    INNER JOIN posts
        ON posts.project_id = publications.project_id
       AND posts.id = publications.post_id
    WHERE publications.project_id = publication_working_drafts.project_id
      AND publications.id = publication_working_drafts.publication_id
);
