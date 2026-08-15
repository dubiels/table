CREATE TABLE `touchpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`occurred_on` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
