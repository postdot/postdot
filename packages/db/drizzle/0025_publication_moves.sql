CREATE TABLE `publication_moves` (
	`project_id` text NOT NULL,
	`source_publication_id` text PRIMARY KEY NOT NULL,
	`destination_publication_id` text NOT NULL,
	`requested_scheduled_at` integer,
	`created_by_actor_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`source_publication_id`) REFERENCES `publications`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`destination_publication_id`) REFERENCES `publications`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`created_by_actor_id`) REFERENCES `actors`(`project_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "publication_moves_distinct" CHECK("publication_moves"."source_publication_id" <> "publication_moves"."destination_publication_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_moves_destination_publication_id_unique` ON `publication_moves` (`destination_publication_id`);--> statement-breakpoint
CREATE INDEX `publication_moves_project_idx` ON `publication_moves` (`project_id`);
--> statement-breakpoint
CREATE TRIGGER publication_moves_same_post BEFORE INSERT ON publication_moves
WHEN (SELECT post_id FROM publications WHERE project_id=NEW.project_id AND id=NEW.source_publication_id)
    IS NOT (SELECT post_id FROM publications WHERE project_id=NEW.project_id AND id=NEW.destination_publication_id)
BEGIN SELECT RAISE(ABORT,'A publication move must retain its source post'); END;
--> statement-breakpoint
CREATE TRIGGER publication_moves_immutable BEFORE UPDATE ON publication_moves
BEGIN SELECT RAISE(ABORT,'Publication move history is immutable'); END;
