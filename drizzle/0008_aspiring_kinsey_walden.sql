CREATE TABLE `cron_run_spans` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`parent_id` text,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`origin` text,
	`label` text,
	`method` text,
	`args` text,
	`result` text,
	`status` text NOT NULL,
	`error` text,
	`started_at` integer NOT NULL,
	`duration_ms` integer,
	FOREIGN KEY (`run_id`) REFERENCES `cron_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `cron_run_spans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cron_run_spans_run_seq` ON `cron_run_spans` (`run_id`,`seq`);--> statement-breakpoint
CREATE INDEX `cron_run_spans_run_parent` ON `cron_run_spans` (`run_id`,`parent_id`);