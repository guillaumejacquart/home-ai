-- Decoupling script/app: storage is no longer implicit, it becomes explicit
-- via `home.app("<appId>").storage`. We snapshot then rewrite the code of
-- attached scripts before dropping the column.
INSERT INTO `script_versions` ("id", "script_id", "version", "name", "schedule", "code", "prompt", "created_at")
SELECT
  lower(hex(randomblob(16))),
  s.`id`,
  (SELECT COALESCE(MAX(v.`version`), 0) + 1 FROM `script_versions` v WHERE v.`script_id` = s.`id`),
  s.`name`,
  s.`schedule`,
  s.`code`,
  'Snapshot avant découplage app/script',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `scripts` s
WHERE s.`app_id` IS NOT NULL;--> statement-breakpoint
-- `home.storage.global` must survive: set it aside for the duration of the replacement.
UPDATE `scripts`
SET `code` = replace(
  replace(
    replace(`code`, 'home.storage.global', '@@HOME_GLOBAL@@'),
    'home.storage',
    'home.app("' || `app_id` || '").storage'
  ),
  '@@HOME_GLOBAL@@',
  'home.storage.global'
)
WHERE `app_id` IS NOT NULL AND `code` LIKE '%home.storage%';--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_scripts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`name` text NOT NULL,
	`trigger_kind` text DEFAULT 'schedule' NOT NULL,
	`schedule` text NOT NULL,
	`webhook_slug` text,
	`webhook_secret` text,
	`code` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`next_run_at` integer,
	`last_run_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_scripts`("id", "owner_id", "visibility", "name", "trigger_kind", "schedule", "webhook_slug", "webhook_secret", "code", "enabled", "next_run_at", "last_run_at", "created_at", "updated_at") SELECT "id", "owner_id", "visibility", "name", "trigger_kind", "schedule", "webhook_slug", "webhook_secret", "code", "enabled", "next_run_at", "last_run_at", "created_at", "updated_at" FROM `scripts`;--> statement-breakpoint
DROP TABLE `scripts`;--> statement-breakpoint
ALTER TABLE `__new_scripts` RENAME TO `scripts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `scripts_webhook_slug` ON `scripts` (`webhook_slug`);