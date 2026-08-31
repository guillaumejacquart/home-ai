CREATE TABLE `global_storage` (
	`owner_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`kind` text DEFAULT 'kv' NOT NULL,
	`schema` text,
	`visibility` text DEFAULT 'private' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `global_storage_owner_key` ON `global_storage` (`owner_id`,`key`);--> statement-breakpoint
ALTER TABLE `app_storage` ADD `kind` text DEFAULT 'kv' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_storage` ADD `schema` text;--> statement-breakpoint
ALTER TABLE `app_versions` ADD `manifest` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `manifest` text;