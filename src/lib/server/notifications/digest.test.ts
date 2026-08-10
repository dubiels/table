import { describe, it, expect } from 'vitest';
import { buildMorningDigestContent } from './digest';

describe('buildMorningDigestContent', () => {
	// Constructed in local time on purpose: due dates are local YYYY-MM-DD, and
	// the suite pins TZ so these instants mean the same thing everywhere.
	const today = new Date(2026, 6, 18, 8, 0); // 08:00 local, 2026-07-18

	it('summarizes counts of overdue, due today, and total open tasks', () => {
		const tasks = [
			{ id: '1', title: 'Overdue thing', dueDate: '2026-07-17', done: false },
			{ id: '2', title: 'Due today thing', dueDate: '2026-07-18', done: false },
			{ id: '3', title: 'No due date', dueDate: null, done: false }
		];
		const result = buildMorningDigestContent(tasks, today);
		expect(result.text).toContain('3 open task');
		expect(result.text).toContain('1 overdue');
		expect(result.text).toContain('1 due today');
		expect(result.taskIds.sort()).toEqual(['1', '2', '3']);
	});

	it('does not roll over to tomorrow late in the evening', () => {
		// 23:30 local is already tomorrow in UTC, which made today's tasks read
		// as overdue and tomorrow's as due today, hours early.
		const lateEvening = new Date(2026, 6, 18, 23, 30);
		const tasks = [
			{ id: '1', title: 'Due today', dueDate: '2026-07-18', done: false },
			{ id: '2', title: 'Due tomorrow', dueDate: '2026-07-19', done: false }
		];
		const result = buildMorningDigestContent(tasks, lateEvening);
		expect(result.text).toContain('1 due today');
		expect(result.text).not.toContain('overdue');
	});

	it('handles an empty table', () => {
		const result = buildMorningDigestContent([], today);
		expect(result.text).toContain('nothing on the table');
		expect(result.taskIds).toEqual([]);
	});
});
