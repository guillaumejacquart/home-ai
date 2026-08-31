CREATE TABLE `agent_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`parts` text NOT NULL,
	`model` text,
	`seq` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `agent_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_messages_thread` ON `agent_messages` (`thread_id`,`seq`);--> statement-breakpoint
CREATE TABLE `agent_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`context_kind` text DEFAULT 'assistant' NOT NULL,
	`context_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_threads_user` ON `agent_threads` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `agent_threads_context` ON `agent_threads` (`user_id`,`context_kind`,`context_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_assistant_memory` (
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
	FOREIGN KEY (`thread_id`) REFERENCES `agent_threads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
-- thread_id is reset to NULL: the old ids pointed to assistant_threads,
-- which is no longer the referenced table. Memory content is preserved.
INSERT INTO `__new_assistant_memory`("id", "user_id", "kind", "content", "source", "thread_id", "pinned", "use_count", "last_used_at", "created_at", "updated_at") SELECT "id", "user_id", "kind", "content", "source", NULL, "pinned", "use_count", "last_used_at", "created_at", "updated_at" FROM `assistant_memory`;--> statement-breakpoint
DROP TABLE `assistant_memory`;--> statement-breakpoint
ALTER TABLE `__new_assistant_memory` RENAME TO `assistant_memory`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `assistant_memory_user` ON `assistant_memory` (`user_id`);