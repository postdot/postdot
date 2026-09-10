PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_instance_state` (
	`id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`bootstrap_blocked` integer DEFAULT false NOT NULL,
	`claimed_by_user_id` text,
	`claimed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`claimed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "instance_state_singleton" CHECK("__new_instance_state"."id" = 'default'),
	CONSTRAINT "instance_state_value_valid" CHECK("__new_instance_state"."state" in ('claimable', 'claimed')),
	CONSTRAINT "instance_state_bootstrap_block_valid" CHECK("__new_instance_state"."bootstrap_blocked" = 0 or "__new_instance_state"."state" = 'claimable'),
	CONSTRAINT "instance_state_claim_consistency" CHECK(("__new_instance_state"."state" = 'claimable' and "__new_instance_state"."claimed_by_user_id" is null and "__new_instance_state"."claimed_at" is null)
                or ("__new_instance_state"."state" = 'claimed' and "__new_instance_state"."claimed_by_user_id" is not null and "__new_instance_state"."claimed_at" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_instance_state`("id", "state", "bootstrap_blocked", "claimed_by_user_id", "claimed_at", "created_at", "updated_at") SELECT "id", "state", "bootstrap_blocked", "claimed_by_user_id", "claimed_at", "created_at", "updated_at" FROM `instance_state`;--> statement-breakpoint
DROP TABLE `instance_state`;--> statement-breakpoint
ALTER TABLE `__new_instance_state` RENAME TO `instance_state`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
UPDATE instance_state
SET bootstrap_blocked = CASE
    WHEN EXISTS (SELECT 1 FROM projects)
     AND NOT EXISTS (SELECT 1 FROM user)
    THEN 1
    ELSE 0
END
WHERE id = 'default';
