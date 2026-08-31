ALTER TABLE `user_settings` ADD `brief_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `brief_hour` integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `brief_last_run_at` integer;