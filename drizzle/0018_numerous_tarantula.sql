CREATE TABLE `llm_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`feature` text DEFAULT 'unknown' NOT NULL,
	`status` text DEFAULT 'success' NOT NULL,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`total_tokens` integer,
	`estimated` integer DEFAULT false NOT NULL,
	`cost_micros` integer,
	`duration_ms` integer,
	`app_id` text,
	`cron_id` text,
	`thread_id` text,
	`error` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cron_id`) REFERENCES `crons`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `llm_usage_user_created` ON `llm_usage` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `llm_usage_app` ON `llm_usage` (`app_id`);--> statement-breakpoint
CREATE INDEX `llm_usage_cron` ON `llm_usage` (`cron_id`);--> statement-breakpoint
CREATE INDEX `llm_usage_feature` ON `llm_usage` (`feature`);--> statement-breakpoint
ALTER TABLE `user_settings` ADD `ai_daily_token_limit` integer;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `ai_weekly_token_limit` integer;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `ai_monthly_token_limit` integer;