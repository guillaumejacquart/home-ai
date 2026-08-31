CREATE TABLE `cron_storage` (
	`cron_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`cron_id`) REFERENCES `crons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cron_storage_cron_key` ON `cron_storage` (`cron_id`,`key`);
--> statement-breakpoint
-- Rebuild `crons`: app_id becomes optional, add owner_id + visibility.
-- Existing crons inherit the owner and visibility of their app.
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_crons` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text,
	`owner_id` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`name` text NOT NULL,
	`schedule` text NOT NULL,
	`code` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`next_run_at` integer,
	`last_run_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_crons`("id", "app_id", "owner_id", "visibility", "name", "schedule", "code", "enabled", "next_run_at", "last_run_at", "created_at", "updated_at")
SELECT c."id", c."app_id", COALESCE(a."owner_id", 'unknown'), COALESCE(a."visibility", 'private'), c."name", c."schedule", c."code", c."enabled", c."next_run_at", c."last_run_at", c."created_at", c."updated_at"
FROM `crons` c LEFT JOIN `apps` a ON a."id" = c."app_id";
--> statement-breakpoint
DROP TABLE `crons`;
--> statement-breakpoint
ALTER TABLE `__new_crons` RENAME TO `crons`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
-- Renames the generation chat `app_messages` -> `generation_messages`, with
-- an owner_id derived from the app or the cron. Preserves existing history.
CREATE TABLE `generation_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text,
	`cron_id` text,
	`owner_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`model` text,
	`version_id` text,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cron_id`) REFERENCES `crons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `generation_messages`("id", "app_id", "cron_id", "owner_id", "role", "content", "model", "version_id", "duration_ms", "created_at")
SELECT m."id", m."app_id", m."cron_id", COALESCE(a."owner_id", c."owner_id", 'unknown'), m."role", m."content", m."model", m."version_id", m."duration_ms", m."created_at"
FROM `app_messages` m
LEFT JOIN `apps` a ON a."id" = m."app_id"
LEFT JOIN `crons` c ON c."id" = m."cron_id";
--> statement-breakpoint
CREATE INDEX `generation_messages_app_id` ON `generation_messages` (`app_id`);
--> statement-breakpoint
CREATE INDEX `generation_messages_cron_id` ON `generation_messages` (`cron_id`);
--> statement-breakpoint
DROP TABLE `app_messages`;
