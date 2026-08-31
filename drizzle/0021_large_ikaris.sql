ALTER TABLE `crons` ADD `trigger_kind` text NOT NULL DEFAULT 'schedule';--> statement-breakpoint
ALTER TABLE `crons` ADD `webhook_slug` text;--> statement-breakpoint
ALTER TABLE `crons` ADD `webhook_secret` text;--> statement-breakpoint
CREATE UNIQUE INDEX `crons_webhook_slug` ON `crons` (`webhook_slug`);