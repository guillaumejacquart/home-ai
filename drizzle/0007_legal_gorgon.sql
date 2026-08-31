CREATE TABLE `dashboards` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`owner_id` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`layout` text DEFAULT '{"cols":12,"widgets":[]}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dashboards_slug_unique` ON `dashboards` (`slug`);