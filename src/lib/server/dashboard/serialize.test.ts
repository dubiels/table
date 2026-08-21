import { describe, it, expect } from 'vitest';
import { buildDashboardPayload } from './serialize';

const zoneRows = [
	{ id: 'z-big', name: 'School', color: 'sage', x: 0, y: 0, width: 600, height: 600 },
	{ id: 'z-small', name: 'Exams', color: 'blush', x: 0, y: 0, width: 300, height: 300 }
];

function task(overrides: Record<string, unknown> = {}) {
	return {
		id: 't1',
		title: 'a task',
		dueDate: null,
		plannedDate: null,
		priority: null,
		source: 'manual',
		courseName: null,
		x: 2000,
		y: 2000,
		...overrides
	};
}

describe('buildDashboardPayload', () => {
	it('resolves a loose task to zone null', () => {
		const p = buildDashboardPayload(
			[task()],
			zoneRows,
			new Date('2026-08-09T12:00:00Z'),
			'America/New_York'
		);
		expect(p.tasks[0].zone).toBeNull();
	});

	it('resolves overlapping zones to the smaller-area zone', () => {
		const p = buildDashboardPayload(
			[task({ x: 10, y: 10 })],
			zoneRows,
			new Date(),
			'America/New_York'
		);
		expect(p.tasks[0].zone).toEqual({ id: 'z-small', name: 'Exams', color: 'blush' });
	});

	it('sorts by dueDate asc with nulls last, then priority desc, then title', () => {
		const p = buildDashboardPayload(
			[
				task({ id: 'none', dueDate: null, title: 'zzz' }),
				task({ id: 'late', dueDate: '2026-09-01' }),
				task({ id: 'soon-low', dueDate: '2026-08-10', priority: 'low', title: 'b' }),
				task({ id: 'soon-high', dueDate: '2026-08-10', priority: 'high', title: 'a' })
			],
			zoneRows,
			new Date(),
			'America/New_York'
		);
		expect(p.tasks.map((t) => t.id)).toEqual(['soon-high', 'soon-low', 'late', 'none']);
	});

	it('ships only render fields — no coordinates or internals', () => {
		const p = buildDashboardPayload([task()], zoneRows, new Date(), 'America/New_York');
		expect(Object.keys(p.tasks[0]).sort()).toEqual(
			['courseName', 'dueDate', 'id', 'plannedDate', 'priority', 'source', 'title', 'zone'].sort()
		);
	});

	it('carries generatedAt and timezone through', () => {
		const p = buildDashboardPayload(
			[],
			[],
			new Date('2026-08-09T12:30:00.000Z'),
			'America/New_York'
		);
		expect(p.generatedAt).toBe('2026-08-09T12:30:00.000Z');
		expect(p.timezone).toBe('America/New_York');
	});
});

describe('the planned date in the payload', () => {
	it('carries the plan alongside the deadline', () => {
		const payload = buildDashboardPayload(
			[task({ id: 't1', dueDate: '2026-09-01', plannedDate: '2026-08-20' })],
			[],
			new Date('2026-08-21T12:00:00Z'),
			'America/New_York'
		);

		expect(payload.tasks[0]).toMatchObject({
			dueDate: '2026-09-01',
			plannedDate: '2026-08-20'
		});
	});

	it('still orders by the deadline', () => {
		// The wall shows what is actually due. A plan can be moved; a deadline
		// cannot, so it stays the sort key.
		const payload = buildDashboardPayload(
			[
				task({ id: 'later', dueDate: '2026-09-05', plannedDate: '2026-08-01' }),
				task({ id: 'sooner', dueDate: '2026-09-01', plannedDate: '2026-08-30' })
			],
			[],
			new Date('2026-08-21T12:00:00Z'),
			'America/New_York'
		);

		expect(payload.tasks.map((t) => t.id)).toEqual(['sooner', 'later']);
	});
});
