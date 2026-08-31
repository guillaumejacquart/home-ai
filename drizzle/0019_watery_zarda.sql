ALTER TABLE `cron_storage` ADD `kind` text DEFAULT 'kv' NOT NULL;--> statement-breakpoint
ALTER TABLE `cron_storage` ADD `schema` text;