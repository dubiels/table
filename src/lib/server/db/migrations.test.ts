import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * Found by content rather than by name: drizzle-kit picks the filename, so
 * matching on one would break the moment a later migration is generated.
 */
function plannedDateMigration(): string {
	const dir = path.resolve('drizzle');
	for (const name of readdirSync(dir).filter((n) => n.endsWith('.sql'))) {
		const sql = readFileSync(path.join(dir, name), 'utf8');
		if (sql.includes('planned_date')) return sql;
	}
	throw new Error('no migration adds planned_date');
}

describe('planned_date backfill', () => {
	it('plans every Google-bound task and leaves the rest unplanned', () => {
		const db = new Database(':memory:');
		db.exec(`
			CREATE TABLE tasks (
				id TEXT PRIMARY KEY,
				due_date TEXT,
				google_sync INTEGER NOT NULL DEFAULT 0,
				google_task_id TEXT
			);
			INSERT INTO tasks (id, due_date, google_sync, google_task_id) VALUES
				('linked',   '2026-03-04', 1, 'g1'),
				('optedin',  '2026-03-05', 1, NULL),
				('orphaned', '2026-03-06', 0, 'g2'),
				('local',    '2026-03-07', 0, NULL),
				('undated',  NULL,         1, 'g3');
		`);

		for (const statement of plannedDateMigration().split('--> statement-breakpoint')) {
			db.exec(statement);
		}

		const rows = db.prepare('SELECT id, planned_date FROM tasks ORDER BY id').all();

		expect(rows).toEqual([
			// Already in Google: a null plan here would blank its date on the very
			// first reconcile.
			{ id: 'linked', planned_date: '2026-03-04' },
			// Never opted in, so it has no plan and wants none.
			{ id: 'local', planned_date: null },
			// Opted in but not yet created — the half of the predicate that stops
			// this task from being stranded, its create gated on a plan forever.
			{ id: 'optedin', planned_date: '2026-03-05' },
			{ id: 'orphaned', planned_date: '2026-03-06' },
			// Nothing to copy: no deadline means no plan either.
			{ id: 'undated', planned_date: null }
		]);

		db.close();
	});
});
