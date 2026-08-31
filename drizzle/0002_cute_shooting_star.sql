CREATE TABLE `cron_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`cron_id` text NOT NULL,
	`version` integer NOT NULL,
	`name` text NOT NULL,
	`schedule` text NOT NULL,
	`code` text NOT NULL,
	`prompt` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`cron_id`) REFERENCES `crons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `app_messages` ADD `cron_id` text REFERENCES crons(id);