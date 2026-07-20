CREATE TABLE `zones` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'sage' NOT NULL,
	`x` integer DEFAULT 0 NOT NULL,
	`y` integer DEFAULT 0 NOT NULL,
	`width` integer DEFAULT 320 NOT NULL,
	`height` integer DEFAULT 320 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
-- Backfill: turn each existing topic into a zone laid out left-to-right.
INSERT INTO zones (id, name, color, x, y, width, height, created_at)
SELECT
	id,
	name,
	CASE (sort_order % 6)
		WHEN 0 THEN 'sage' WHEN 1 THEN 'sky' WHEN 2 THEN 'butter'
		WHEN 3 THEN 'blush' WHEN 4 THEN 'lilac' ELSE 'clay' END,
	40 + (sort_order % 4) * 360,
	40 + (sort_order / 4) * 360,
	320,
	320,
	created_at
FROM topics
WHERE status = 'active';
--> statement-breakpoint
DROP TABLE `topics`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`due_date` text,
	`priority` text,
	`done` integer DEFAULT false NOT NULL,
	`x` integer DEFAULT 0 NOT NULL,
	`y` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
-- Scatter existing tasks into their former topic's zone bounds (topic_id is
-- read here, before the old tasks table and its topic_id column are dropped).
INSERT INTO `__new_tasks`("id", "title", "notes", "due_date", "priority", "done", "x", "y", "sort_order", "created_at")
SELECT
	"id", "title", "notes", "due_date", "priority", "done",
	COALESCE((SELECT z.x FROM zones z WHERE z.id = tasks.topic_id), 60) + (abs(random()) % 120),
	COALESCE((SELECT z.y FROM zones z WHERE z.id = tasks.topic_id), 60) + (abs(random()) % 160),
	"sort_order", "created_at"
FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;