ALTER TABLE `user` ADD `role` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `banned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `ban_reason` text;--> statement-breakpoint
ALTER TABLE `user` ADD `ban_expires` integer;--> statement-breakpoint
-- Backfill RBAC : le premier compte créé devient admin.
UPDATE `user` SET `role` = 'admin' WHERE `id` = (SELECT `id` FROM `user` ORDER BY `created_at` ASC LIMIT 1);