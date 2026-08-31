CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`provider` text,
	`planner_model` text,
	`coder_model` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
