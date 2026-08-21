ALTER TABLE `tasks` ADD `planned_date` text;--> statement-breakpoint
UPDATE `tasks` SET `planned_date` = `due_date`
WHERE `google_sync` = 1 OR `google_task_id` IS NOT NULL;
