ALTER TABLE `tasks` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `external_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `course_name` text;