CREATE TABLE `google_task_tombstones` (
	`google_task_id` text PRIMARY KEY NOT NULL,
	`deleted_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `updated_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `google_sync` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `google_task_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `google_synced_at` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `google_updated_at` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `google_error` text;--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_google_task_id_idx` ON `tasks` (`google_task_id`);--> statement-breakpoint
UPDATE `tasks` SET `updated_at` = `created_at` WHERE `updated_at` = '';