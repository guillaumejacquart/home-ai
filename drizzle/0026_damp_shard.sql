CREATE TABLE `mcp_tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`token_prefix` text,
	`args` text,
	`result` text,
	`status` text NOT NULL,
	`error` text,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mcp_tool_calls_user_created` ON `mcp_tool_calls` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `mcp_tool_calls_user_tool` ON `mcp_tool_calls` (`user_id`,`tool_name`);