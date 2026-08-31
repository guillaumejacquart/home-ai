CREATE TABLE `provider_keys` (
	`provider` text PRIMARY KEY NOT NULL,
	`api_key` blob NOT NULL,
	`updated_at` integer NOT NULL
);
