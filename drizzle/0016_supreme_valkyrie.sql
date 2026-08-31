CREATE TABLE `assistant_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text DEFAULT 'fact' NOT NULL,
	`content` text NOT NULL,
	`source` text DEFAULT 'auto' NOT NULL,
	`thread_id` text,
	`pinned` integer DEFAULT false NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `assistant_threads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `assistant_memory_user` ON `assistant_memory` (`user_id`);--> statement-breakpoint
ALTER TABLE `user_settings` ADD `assistant_model` text;