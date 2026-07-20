ALTER TABLE `tasks` ADD `completed_at` text;
--> statement-breakpoint
-- Backfill: tasks already marked done before this column existed get their
-- creation time as a best-effort completion time, so they show up in history.
UPDATE tasks SET completed_at = created_at WHERE done = 1 AND completed_at IS NULL;