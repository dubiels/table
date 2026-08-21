CREATE TABLE `agent_idempotency` (
	`key` text PRIMARY KEY NOT NULL,
	`route` text NOT NULL,
	`status` integer,
	`response` text,
	`created_at` text NOT NULL
);
