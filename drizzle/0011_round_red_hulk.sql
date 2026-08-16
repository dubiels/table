CREATE TABLE `cities` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`ascii_name` text NOT NULL,
	`search_key` text NOT NULL,
	`country_code` text NOT NULL,
	`country_name` text NOT NULL,
	`admin1_code` text,
	`admin1_name` text,
	`population` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cities_search_key_idx` ON `cities` (`search_key`);--> statement-breakpoint
CREATE TABLE `city_aliases` (
	`city_id` integer NOT NULL,
	`alias` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `city_aliases_alias_idx` ON `city_aliases` (`alias`);--> statement-breakpoint
CREATE TABLE `city_dataset_meta` (
	`id` integer PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`city_count` integer NOT NULL,
	`loaded_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `people` ADD `city_id` integer;