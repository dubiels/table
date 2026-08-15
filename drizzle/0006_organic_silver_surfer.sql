CREATE TABLE `flags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'sage' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `flags_name_unique` ON `flags` (`name`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`linkedin_url` text,
	`email` text,
	`phone` text,
	`company` text,
	`role` text,
	`city` text,
	`met_at` text,
	`met_on` text,
	`notes` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `people_flags` (
	`person_id` text NOT NULL,
	`flag_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`person_id`, `flag_id`),
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`flag_id`) REFERENCES `flags`(`id`) ON UPDATE no action ON DELETE no action
);
