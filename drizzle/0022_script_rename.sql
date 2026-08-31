ALTER TABLE `crons` RENAME TO `scripts`;--> statement-breakpoint
ALTER TABLE `cron_storage` RENAME TO `script_storage`;--> statement-breakpoint
ALTER TABLE `script_storage` RENAME COLUMN `cron_id` TO `script_id`;--> statement-breakpoint
ALTER TABLE `cron_runs` RENAME TO `script_runs`;--> statement-breakpoint
ALTER TABLE `script_runs` RENAME COLUMN `cron_id` TO `script_id`;--> statement-breakpoint
ALTER TABLE `cron_versions` RENAME TO `script_versions`;--> statement-breakpoint
ALTER TABLE `script_versions` RENAME COLUMN `cron_id` TO `script_id`;--> statement-breakpoint
ALTER TABLE `cron_run_spans` RENAME TO `script_run_spans`;--> statement-breakpoint
ALTER TABLE `llm_usage` RENAME COLUMN `cron_id` TO `script_id`;--> statement-breakpoint
DROP INDEX `crons_webhook_slug`;--> statement-breakpoint
CREATE UNIQUE INDEX `scripts_webhook_slug` ON `scripts` (`webhook_slug`);--> statement-breakpoint
DROP INDEX `cron_storage_cron_key`;--> statement-breakpoint
CREATE UNIQUE INDEX `script_storage_script_key` ON `script_storage` (`script_id`, `key`);--> statement-breakpoint
DROP INDEX `cron_run_spans_run_seq`;--> statement-breakpoint
CREATE INDEX `script_run_spans_run_seq` ON `script_run_spans` (`run_id`, `seq`);--> statement-breakpoint
DROP INDEX `cron_run_spans_run_parent`;--> statement-breakpoint
CREATE INDEX `script_run_spans_run_parent` ON `script_run_spans` (`run_id`, `parent_id`);--> statement-breakpoint
DROP INDEX `llm_usage_cron`;--> statement-breakpoint
CREATE INDEX `llm_usage_script` ON `llm_usage` (`script_id`);--> statement-breakpoint
UPDATE `assistant_threads` SET `context_kind` = 'script' WHERE `context_kind` = 'cron';