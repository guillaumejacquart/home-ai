ALTER TABLE `assistant_messages` ADD `version_id` text;--> statement-breakpoint
ALTER TABLE `assistant_messages` ADD `duration_ms` integer;--> statement-breakpoint
ALTER TABLE `assistant_threads` ADD `context_kind` text DEFAULT 'assistant' NOT NULL;--> statement-breakpoint
ALTER TABLE `assistant_threads` ADD `context_id` text;--> statement-breakpoint
CREATE INDEX `assistant_threads_context` ON `assistant_threads` (`context_kind`,`context_id`);--> statement-breakpoint
-- Backfill : un thread par app/cron ayant un historique dans generation_messages
INSERT INTO `assistant_threads` (`id`, `user_id`, `title`, `context_kind`, `context_id`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(16))), g.`owner_id`, COALESCE(a.`name`, substr(g.`content`, 1, 80)), 'app', g.`app_id`, min(g.`created_at`), max(g.`created_at`)
FROM `generation_messages` g
LEFT JOIN `apps` a ON a.`id` = g.`app_id`
WHERE g.`app_id` IS NOT NULL AND g.`cron_id` IS NULL
GROUP BY g.`owner_id`, g.`app_id`;--> statement-breakpoint
INSERT INTO `assistant_threads` (`id`, `user_id`, `title`, `context_kind`, `context_id`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(16))), g.`owner_id`, COALESCE(c.`name`, substr(g.`content`, 1, 80)), 'cron', g.`cron_id`, min(g.`created_at`), max(g.`created_at`)
FROM `generation_messages` g
LEFT JOIN `crons` c ON c.`id` = g.`cron_id`
WHERE g.`cron_id` IS NOT NULL
GROUP BY g.`owner_id`, g.`cron_id`;--> statement-breakpoint
INSERT INTO `assistant_messages` (`id`, `thread_id`, `role`, `content`, `model`, `version_id`, `duration_ms`, `created_at`)
SELECT g.`id`, t.`id`, g.`role`, g.`content`, g.`model`, g.`version_id`, g.`duration_ms`, g.`created_at`
FROM `generation_messages` g
JOIN `assistant_threads` t ON (
  (g.`cron_id` IS NOT NULL AND t.`context_kind` = 'cron' AND t.`context_id` = g.`cron_id`)
  OR
  (g.`cron_id` IS NULL AND g.`app_id` IS NOT NULL AND t.`context_kind` = 'app' AND t.`context_id` = g.`app_id`)
);